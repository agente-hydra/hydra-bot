# Proposal — Memória Estruturada, RAG Seguro e Isolamento Rigoroso do Hydra (Revisada)

## 1. Problema e Diagnóstico

O Hydra consolidou com sucesso o Revisor Crítico de IA (AI Reviewer), a autorização delimitada de lojas e o encavalamento de mensagens. No entanto, a camada de **identidade, memória e contexto** ainda possui vulnerabilidades arquiteturais que demandam blindagem rigorosa:

1. **Fronteira de Acesso e Autenticação de Ingress:**
   - A autorização atual utiliza conjuntos estáticos em memória (`WHITELIST` em `webhook-listener.js` e `AUTHORIZED_NUMBERS` em `command_interceptor.ts`).
   - Não há distinção entre *usuários autorizados para usar o bot* e *usuários autorizados para simular perfis* (`/socio`, `/{loja}`). Um gerente legítimo não pode ter acesso a comandos de troca de persona.
   - O webhook precisa autenticar a Evolution API de forma compatível e segura: validar secret quando configurado sem quebrar o transporte existente antes da ativação mútua.
   - A resolução de Phone/LID carece de tabela persistente de identidades confiáveis para evitar falsas rejeições ou vazamento de LIDs não mapeados.
   - A checagem de autorização precisa ser contínua: deve ocorrer no Ingress, no consumo da fila, na execução de ferramentas e antes do envio de balões.

2. **Memória Monolítica sem Escopo Efetivo e com Risco de Vazamento Cross-Profile:**
   - A tabela `hydra_user_memory` agrupa dados em colunas JSON monolíticas (`daily_topics_json`, `weekly_preferences_json`), sem granularidade atômica, status de ciclo de vida (`candidate`, `active`, `superseded`, `expired`, `invalidated`) nem proveniência.
   - **Vazamento de Escopo:** Memórias de rede (`scope_type = 'rede'`) **não podem** ser recuperadas quando o usuário estiver operando como gerente de uma loja. Preferências pessoais de apresentação (ex: "exibir CMV em %") exigem escopo próprio (`perfil_global`) sem conteúdo de loja/rede.
   - **Direitos Reais vs Perfil Efetivo:** Um usuário com permissão de sócio (`allowedStores = ['*']`), ao assumir a persona de gerente da Jorge Beretta (`MPJorgeBeretta`), deve ficar **estritamente confinado à Jorge Beretta**, tanto nas ferramentas quanto na memória e no RAG.
   - **Risco pós-Reset:** O comando `/reset` incrementa a geração da conversa (`memory_generation++`). Registros de gerações antigas não podem reaparecer no RAG, na consolidação ou nos briefings.

3. **Consolidação Determinística sem LLM e sem Mistura de Chaves:**
   - A consolidação de memória não pode agrupar dados apenas por `phone + topic_key`. Deve agrupar obrigatoriamente pela chave composta completa:
     $$\text{Chave} = \text{phone} + \text{generation\_id} + \text{scope\_type} + \text{loja\_slug} + \text{topic\_key}$$
   - Deduplicação estável por IDs de mensagens/turnos: reexecuções de jobs, retries de webhook ou reavaliações do revisor não podem inflar contadores de frequência.
   - Janelas completas com checkpoints e watermarks para que mensagens próximas da meia-noite no fuso `America/Sao_Paulo` não sejam perdidas.
   - **Zero chamadas adicionais ao LLM e zero envios espúrios ao WhatsApp.**

4. **Validação de Memória Equilibrada (Anti-Factual vs Preferências Legítimas):**
   - Não bloquear preferências legítimas apenas por conterem palavras como "faturamento", símbolos de "%" ou números (ex: "prefiro faturamento antes de OSs", "mostre CMV em %", "retidos significa mais de 5 dias").
   - Diferenciar **regras/preferências de interpretação** de **fatos operacionais voláteis** (ex: saldos de OSs específicas, faturamento realizado em data X).
   - Confiança informada pelo modelo não promove inferência a preferência confirmada; inferências continuam sendo interesses derivados (`derived_interest`).

5. **Preservação Operacional na Migração:**
   - Manter os parâmetros vigentes já testados e aprovados: **debounce de 1.500 ms (teto de 5.000 ms)** e **TTL de contexto de 120 minutos**.
   - Migração idempotente de usuários: reexecuções de seeds nunca devem reativar usuários revogados (`is_active = 0`).

---

## 2. Solução Proposta

```
[Webhook Ingress] 
       │
       ▼
[Barreira 1: Auth & Identity Guard] ──(Não Cadastrado)──► HTTP 200 Silencioso + Audit Sanitizada (Zero IA/Mídia/Msg)
       │
       ▼ (Contexto Autorizado: phone + generation + perfil efetivo + loja ativa)
[Debounce 1.500ms & Fila Isolada por Número]
       │
       ▼
[Barreira 2: Revalidação de Fila] ──(Revogado em voo)──► Aborta Silenciosamente
       │
       ▼
[RAG Pré-Filtrado por Escopo Efetivo] (<150 tokens)
  ↳ Gerente: apenas loja ativa + perfil_global (Zero vazamento de rede!)
  ↳ Sócio: apenas rede + perfil_global
       │
       ▼
[Barreira 3: Revalidação de Ferramentas] ──► Executa estritamente na loja autorizada
       │
       ▼
[Revisor Crítico de IA (Turno Único)] 
  ↳ Resposta Operacional + Candidatos de Memória no MESMO JSON (Zero LLM extra)
       │
       ▼
[Validador Determinístico de Memória] ──► Persistência Atômica (hydra_memories)
       │
       ▼
[Barreira 4: Revalidação Pré-Envio] ──► Envio WhatsApp via Evolution API + Reação ✅
       │
       ▼
[Consolidador Diário & Semanal sem LLM] ──► Jobs Idempotentes (Watermark em America/Sao_Paulo)
```

---

## 3. Contratos de Dados e Schemas

### 3.1. Identidade e Autorização Segregada

```sql
CREATE TABLE IF NOT EXISTS hydra_authorized_users (
  phone TEXT PRIMARY KEY,               -- E.164 canônico: '5511996242812'
  name TEXT NOT NULL,                   -- Nome do operador
  role TEXT NOT NULL DEFAULT 'gerente', -- 'socio', 'gerente', 'operador'
  allowed_stores TEXT NOT NULL,         -- JSON array: ["MPJorgeBeretta"] ou ["*"] para sócios
  is_active INTEGER NOT NULL DEFAULT 1, -- 1 = ativo, 0 = revogado
  can_simulate_persona INTEGER NOT NULL DEFAULT 0, -- 1 = autorizado a usar /socio e /{loja}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hydra_phone_identities (
  remote_jid TEXT PRIMARY KEY,          -- Ex: '271077481652389@lid' ou '5511996242812@s.whatsapp.net'
  phone_canonical TEXT NOT NULL,        -- Número E.164 canônico
  identity_type TEXT NOT NULL,          -- 'PN' ou 'LID'
  push_name TEXT,
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (phone_canonical) REFERENCES hydra_authorized_users(phone)
);
CREATE INDEX IF NOT EXISTS idx_phone_identities_canonical ON hydra_phone_identities(phone_canonical);
```

### 3.2. Memória Atômica com Escopo Efetivo Completo

```sql
CREATE TABLE IF NOT EXISTS hydra_memories (
  memory_id TEXT PRIMARY KEY,           -- ID único atômico
  phone TEXT NOT NULL,                  -- Telefone canônico proprietário
  generation_id INTEGER NOT NULL,       -- Geração vinculada (invalida no /reset)
  scope_type TEXT NOT NULL,             -- 'perfil_global', 'rede', 'loja'
  loja_slug TEXT,                       -- Slug da loja ou NULL para rede/perfil_global
  memory_type TEXT NOT NULL,            -- 'explicit_preference', 'correction', 'derived_interest'
  topic_key TEXT NOT NULL,              -- Chave semântica (ex: 'cmv_display_unit', 'alias_retidos')
  content_normalized TEXT NOT NULL,     -- Regra/preferência normalizada
  evidence_text TEXT NOT NULL,          -- Trecho que motivou a memória
  source_turn_ids TEXT NOT NULL DEFAULT '[]', -- JSON array de turnIds/messageIds para deduplicação
  status TEXT NOT NULL DEFAULT 'active',-- 'candidate', 'active', 'superseded', 'expired', 'invalidated'
  confidence REAL NOT NULL DEFAULT 1.0, -- Confiança (0.0 a 1.0)
  occurrence_count INTEGER DEFAULT 1,   -- Contagem idempotente de ocorrências
  distinct_days_json TEXT DEFAULT '[]', -- Datas distintas em America/Sao_Paulo: ["2026-09-28", "2026-09-30"]
  superseded_by TEXT,                   -- ID da memória sucessora se superseded
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,                  -- Data de expiração por TTL
  FOREIGN KEY (phone) REFERENCES hydra_authorized_users(phone)
);
CREATE INDEX IF NOT EXISTS idx_memories_scoped_lookup 
  ON hydra_memories(phone, generation_id, status, scope_type, loja_slug, topic_key);
```

### 3.3. Checkpoints de Consolidação

```sql
CREATE TABLE IF NOT EXISTS hydra_memory_consolidation_checkpoints (
  job_type TEXT PRIMARY KEY,            -- 'daily' ou 'weekly'
  last_processed_timestamp TEXT NOT NULL, -- Watermark ISO 8601
  last_processed_turn_id TEXT,
  records_consolidated INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Análise de Riscos e Mitigações

| Risco | Impacto | Mitigação |
| :--- | :---: | :--- |
| **Vazamento de dados da rede para o perfil de gerente** | Crítico | **Regra de Escopo Efetivo:** ao assumir gerente, o filtro de recuperação RAG e ferramentas seleciona estritamente `(scope_type = 'loja' AND loja_slug = :activeLoja) OR scope_type = 'perfil_global'`. Memórias com `scope_type = 'rede'` são bloqueadas incondicionalmente no perfil de gerente. |
| **Bloqueio acidental do webhook da Evolution na ativação** | Alto | **Modo de Compatibilidade Segura:** Se a variável `EVOLUTION_WEBHOOK_SECRET` não estiver configurada no servidor, o Access Guard registra log de compatibilidade e aceita requisições verificando a identidade em `hydra_authorized_users`. Quando o secret for configurado em ambos os lados, a validação de header torna-se obrigatória. |
| **Sobrescrita de revogação de usuário ao rodar seeds** | Alto | Seeds utilizam cláusula `ON CONFLICT(phone) DO NOTHING`, preservando status `is_active = 0` de operadores revogados. |
| **Reativação de memórias antigas por jobs atrasados** | Médio | Todo commit de consolidação confere se a `generation_id` ainda é a geração ativa do perfil no banco. Se ocorreu `/reset` durante a execução, o commit é descartado. |
| **Distorção de contagens por reenvio de webhook** | Médio | Registro de `source_turn_ids` em cada memória. Reexecuções conferem a presença do ID antes de incrementar `occurrence_count`. |
| **Bloqueio indevido de preferências que citam 'faturamento' ou '%'** | Médio | Validador distingue regras de interpretação (permitidas) de fatos operacionais voláteis concretos (bloqueados). |

---

## 5. Divisão de Frentes e Propriedade de Arquivos

* **Agente Principal:** Propriedade exclusiva de [`agent_dispatcher.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/agent_dispatcher.ts) e dos contratos em `types/`. Realiza a unificação, o build gate e o deploy final.
* **Agente 1 (Identidade, Sessão e Janela de Contexto):** Propriedade de `identity_access_guard.ts`, `command_interceptor.ts`, `turn_context_repository.ts`, `webhook-listener.js` e `test_harness_access_session.ts`. Preserva debounce de 1.500 ms e TTL de 120 min.
* **Agente 2 (Memória Estruturada e Consolidação sem LLM):** Propriedade de `memory_repository.ts`, `memory_consolidator.ts`, `semantic_prompt.ts` e `test_harness_memory_consolidation.ts`. Agrupamento completo por 5 chaves, deduplicação estável e zero chamadas LLM.
* **Agente 3 (Recuperação/RAG, Briefings e Harness Integrado):** Propriedade de `memory_retriever.ts`, `ai_briefing.ts` e `test_harness_unified.ts`. RAG com isolamento estrito de escopo efetivo, briefings adaptativos e matriz de 28 cenários com fixtures isoladas.
