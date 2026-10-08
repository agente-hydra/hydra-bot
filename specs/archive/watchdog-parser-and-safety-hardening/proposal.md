# Proposta Técnica: Endurecimento de Parser e Resiliência de Políticas no Watchdog

## 1. Problema Identificado

Durante a auditoria operacional do Watchdog na VPS (`operacional@100.126.50.101`), responsável por auditar conversas dos gerentes de loja no Chatwoot/WhatsApp, foram identificadas duas fragilidades em `/home/operacional/watchdog/worker.js`:

1. **Parser Frágil de JSON no Retorno da CLI `agy` (Linha ~465):**
   - O código atual extrai o JSON da resposta através de:
     ```javascript
     if (content.includes('```json')) {
       content = content.split('```json')[1].split('```')[0].trim();
     }
     ```
   - Quando o stream do `agy` oscila ou o modelo emite múltiplos blocos de código (ex: conversa real 676 no log: `The stream was interrupted. Please continue...`), o `split('```json')[1]` obtém uma fatia intermediária quebrada.
   - Isso resulta em `SyntaxError: Unexpected token`, fazendo a auditoria falhar desnecessariamente e reagendando a conversa para a fila de retries.

2. **Bloqueio por Política de Conteúdo do Google (Safety Policy) sem Tratamento Especializado:**
   - Na conversa real 1369, o Google bloqueou a submissão do prompt:
     `"The prompt could not be submitted. The prompt contains sensitive words that violate Google's Generative AI Prohibited Use policy..."`
   - O transcript bruto do cliente/gerente é interpolado diretamente no prompt sem higienização de termos sensíveis.
   - Quando uma conversa é bloqueada por política, o sistema tenta retries cegos com o mesmo prompt bloqueado por 3 vezes até mover para a DLQ, poluindo métricas de erro da IA e desperdiçando recursos.

---

## 2. Solução Proposta

1. **Parser Robusto de JSON com Fallback Multinível (`extractJsonFromAgyOutput`):**
   - Extração estruturada em ordem de prioridade:
     1. Parse direto se a saída já for JSON puro.
     2. Varredura de todos os blocos ````json ... ```` em ordem reversa (pegando o último bloco completo e bem-formado).
     3. Busca gulosa por delimitação de chaves `{ ... }` completas via substring ou regex balanceado.
     4. Recuperação de fragmentos estruturados com validação de campos obrigatórios (`infracao_detectada`, `codigo_regra`).

2. **Sanitizador Prévio de Conteúdo Sensível para Transcripts:**
   - Criar módulo `lib/sanitizer.js` que limpa termos extremos de baixo calão, ameaças ou palavras gatilho de filtro de IA (substituindo por `[termo_sensível]`), mantendo o sentido semântico para a auditoria de atendimento sem acionar filtros da Google Prohibited Use policy.

3. **Tratamento Inteligente de Erros de Política e Redução de Retries Inválidos:**
   - Se o retorno do `agy` indicar `violates Google's [Generative AI Prohibited Use policy]`:
     - Tentar imediatamente uma segunda avaliação com sanitização agressiva do transcript.
     - Se persistir bloqueado, classificar como `BLOCKED_BY_SAFETY_POLICY`, encerrar o ciclo da conversa e registrar o evento sem entrar em loop de 3 retries de 60s.

---

## 3. Contratos de Dados & Interfaces

### Nova Função de Extração de JSON
```typescript
interface AuditJsonResponse {
  novo_estagio: string;
  novo_passo_resumo: string;
  contexto_resumido: string;
  infracao_detectada: boolean;
  codigo_regra: string;
  descricao_falha: string;
  trecho_cliente: string;
  trecho_gerente: string;
  tipo_mensagem_cliente: string;
  tipo_mensagem_gerente: string;
  score_confianca: number;
}

function extractJsonFromAgyOutput(rawText: string): AuditJsonResponse | null;
```

---

## 4. Risco Principal e Mitigação

- **Risco:** O sanitizador mascarar termos legítimos que configurariam a infração `ATENDIMENTO_DESCASO_OU_RISPIDEZ`.
- **Mitigação:** O sanitizador atua apenas sobre palavras-chave estritas associadas a filtros do Google (violência, conteúdo adulto, termos ilegais), preservando expressões cotidianas de descontentamento de clientes e descaso de gerentes.
