# Design Técnico: Endurecimento de Parser e Resiliência de Políticas no Watchdog

## 1. Arquitetura do Sistema de Monitoramento dos Gerentes

O Watchdog opera como serviço independente em `/home/operacional/watchdog/` com orquestração sob PM2:

```
[ Chatwoot Webhook ] ──► [ gateway.js (Porta 4100) ]
                               │
                               ▼
                       [ Redis 6380 ZSET ] (Sliding Window 20m de silêncio)
                               │
                               ▼
                        [ worker.js ]
                               │
      ┌────────────────────────┴────────────────────────┐
      ▼                                                 ▼
[ safety_sanitizer.js ]                       [ json_extractor.js ]
(Higieniza termos sensíveis)                  (Extrai JSON mesmo com stream quebrado)
      │                                                 │
      └────────────────────────┬────────────────────────┘
                               │
                               ▼
                        [ agy CLI Engine ]
                               │
                               ▼
                   [ Alertas de Infração ]
            ├── Evolution API (Instância hydra exclusiva)
            └── Chatwoot Outbound API
```

---

## 2. Detalhamento dos Componentes

### Componente 1: Extrator Robusto de JSON (`lib/json_extractor.js`)

#### Falha Atual
No `worker.js`:
```javascript
if (content.includes('```json')) {
  content = content.split('```json')[1].split('```')[0].trim();
}
```
Se a resposta contiver múltiplos blocos markdown (comum quando o modelo se autocorrige ou tem o stream interrompido), `.split('```json')[1]` obtém uma fatia inválida.

#### Solução Técnica
Criar módulo reutilizável `lib/json_extractor.js`:
```javascript
function extractJsonFromAgyOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Entrada nula ou vazia para extração de JSON');
  }

  const trimmed = rawText.trim();

  // 1. Tentar parse direto do texto bruto
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === 'object' && direct.response) {
      return extractJsonFromAgyOutput(direct.response);
    }
    if (isValidAuditPayload(direct)) return direct;
  } catch {}

  // 2. Extrair todos os blocos ```json ... ``` ou ``` ... ```
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  const matches = [...trimmed.matchAll(codeBlockRegex)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(matches[i][1].trim());
      if (isValidAuditPayload(parsed)) return parsed;
    } catch {}
  }

  // 3. Extrair delimitador { ... } mais externo
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const slice = trimmed.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(slice);
      if (isValidAuditPayload(parsed)) return parsed;
    } catch {}
  }

  throw new Error('Nenhum objeto JSON compatível com o schema de auditoria foi localizado');
}

function isValidAuditPayload(obj) {
  return obj && typeof obj === 'object' &&
    typeof obj.infracao_detectada === 'boolean' &&
    typeof obj.codigo_regra === 'string';
}
```

---

### Componente 2: Sanitizador de Termos Sensíveis (`lib/safety_sanitizer.js`)

#### Falha Atual
Palavras chulas extremas, termos de conteúdo adulto ou agressões verbais trocadas entre clientes e gerentes são passadas in natura para o Google Gemini via `agy -p ...`, fazendo a API rejeitar o prompt por infração de política (`Prohibited Use policy`).

#### Solução Técnica
Criar `lib/safety_sanitizer.js`:
- Lista calibrada de substituições de termos que ativam gatilhos de filtro de moderação de IA (sem alterar o sentido comercial do atendimento).
- Substitui termos agressivos ou proibidos por marcadores neutros: `[termo_sensível]`, `[linguagem_inadequada]`.
- Se o retorno do `agy` indicar erro de política:
  - Marca o registro com tag `SAFETY_POLICY_BYPASS`.
  - Evita 3 retries inúteis de 60s/120s/180s com a mesma string rejeitada.

---

### Componente 3: Suíte de Testes Automatizada (`test_watchdog_parser_hardening.js`)

Testa em ambiente isolado:
1. Resposta com stream truncado e repetição de tags ````json ```` (reprodução exata da conversa 676).
2. Resposta com texto introdutório antes do JSON.
3. Resposta com quebras de linha em trechos citados.
4. Eficácia do sanitizador em desarmar bloqueios de política.
