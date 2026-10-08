# Design — Hydra: Arquitetura do Obsidian por Número, Memória Persistente e Interpretação Semântica

**Data:** 02 de Outubro de 2026  
**Status:** PROPOSTA / DESIGN TÉCNICO (SDD Proposal)  
**ID da Spec:** `hydra-obsidian-memory-audit`  

---

## 1. Visão Geral da Arquitetura e Fluxo de Dados

A arquitetura resolve a lacuna de memória do Hydra integrando o **Obsidian Vault por Identidade Canônica** como a camada de armazenamento durável e auditável de preferências e correções humanas, enquanto o **SQLite (`hydra_ops.db`)** atua como motor transacional de indexação rápida, controle de autorização, integridade de gerações e telemetria de turnos.

```mermaid
flowchart TD
    subgraph Ingress & Identidade
        W[Webhook WhatsApp / Evolution API] --> Guard[Identity Access Guard]
        Guard --> Canon[Identidade Canônica: phone_canonical]
    end

    subgraph Interpretação Semântica (E1)
        Canon --> Rewriter[Intent Rewriter: Classificação Estrita]
        Rewriter -->|Operacional| Plan[Query Plan / Components]
        Rewriter -->|Obsidian / Diagnóstico| Diag[Runtime Diagnostics Engine]
        Rewriter -->|Histórico Conversa| Hist[Conversation History Service]
    end

    subgraph Execução e Telemetria Real (E3)
        Plan --> Dispatcher[Agent Dispatcher]
        Diag --> Dispatcher
        Hist --> Dispatcher
        Dispatcher --> Worker[Dual Worker Router: AGY / Fallback]
        Worker --> Tracker[Tool Execution Tracker: Trace Factual]
    end

    subgraph Memória e Vault Obsidian (E2)
        Dispatcher --> MemPipe[Pipeline Unificado de Memória: Sócio & Gerente]
        MemPipe --> VaultMgr[Vault Manager: Storage Driver]
        VaultMgr <-->|Notas .md| VaultFS[(/vault/usuarios/phone/)]
        VaultMgr <-->|Índice & Geração| SQLiteDB[(SQLite: hydra_vault_index)]
    end
```

---

## 2. Contratos Tipados TypeScript (Strict, Zero `any`)

Os contratos abaixo serão criados em `src/hydra-sync/types/vault_contract.ts`:

```typescript
/**
 * src/hydra-sync/types/vault_contract.ts
 * Contratos estritos para integração do Obsidian Vault, Diagnóstico de Runtime e Traces.
 */

export type VaultMemoryType = 'explicit_preference' | 'correction' | 'derived_interest';
export type VaultMemoryStatus = 'active' | 'candidate' | 'superseded' | 'revoked';
export type VaultScopeType = 'perfil_global' | 'rede' | 'loja';

export interface VaultFrontmatter {
  id: string;
  owner: string; // phone_canonical (ex: 5511999990001)
  generation_id: number;
  scope_type: VaultScopeType;
  loja_slug: string | null;
  topic_key: string;
  memory_type: VaultMemoryType;
  status: VaultMemoryStatus;
  version: number;
  confidence: number;
  evidence_text: string;
  source_turn_ids: string[];
  created_at: string; // ISO 8601 America/Sao_Paulo
  confirmed_at: string | null;
  expires_at: string | null;
  superseded_by: string | null;
}

export interface VaultNote {
  frontmatter: VaultFrontmatter;
  content: string;
  relativePath: string; // ex: preferencias/mem_...md
  absolutePath: string;
  fileHash: string; // SHA-256 do arquivo em disco
  updatedAt: string;
}

export interface VaultDiagnosticsResult {
  isVaultConfigured: boolean;
  vaultPath: string;
  isAccessible: boolean;
  totalUserNotes: number;
  activeNotesCount: number;
  memoryGeneration: number;
  indexVersion: number;
  pendingOperationsCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface RuntimeDiagnosticsPayload {
  vault: VaultDiagnosticsResult;
  memory: {
    totalActiveMemories: number;
    effectivePersona: 'socio' | 'gerente';
    activeLojaSlug: string | null;
    memoryGeneration: number;
    retrievalSource: 'vault_direct' | 'sqlite_index' | 'empty';
  };
  tools: {
    mcpAvailable: boolean;
    serverStatus: 'connected' | 'disconnected' | 'bypassed';
    registeredTools: string[];
  };
  serverTime: string; // ISO 8601 America/Sao_Paulo
}

export interface ConversationHistoryQuery {
  phone: string;
  generationId?: number;
  scope: 'today' | 'current_generation' | 'all_available';
  queryType: 'first_question' | 'recent_turns' | 'turn_count';
  limit?: number;
}

export interface ConversationHistoryResult {
  queryType: 'first_question' | 'recent_turns' | 'turn_count';
  found: boolean;
  firstQuestion?: {
    text: string;
    timestamp: string;
    turnId: string;
  };
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    turnId: string;
  }>;
  totalTurnCount?: number;
  explanation: string;
}

export interface ToolCallTrace {
  turnId: string;
  toolName: string;
  toolSource: 'mcp' | 'sqlite_adapter' | 'vault';
  inputParams: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  status: 'SUCCESS' | 'ERROR';
  errorMessage?: string;
}
```

---

## 3. Detalhamento dos Componentes por Frente de Execução

### 3.1 Frente 1 (Executor 1): Interpretação, Diagnóstico e Prompt Seguro
**Sessão Vinculada:** `Hydra Operational Context Handoff` (`de5452f5-ae9d-4de2-af64-0b12f075f5ea`)

#### 1. Correção Imediata do `intent_rewriter.ts` (Eliminação do Bug da Substring `dia`)
- **Problema:** Linha 2498 do `intent_rewriter.ts` captura qualquer string contendo `"dia"` (inclusive `"obsidian"` e `"diagnostico"`) e reescreve como listagem de pátio.
- **Solução Arquitetural:** 
  - Substituir a condição por regex gramatical estrita que exija combinação de entidade de pátio com termos temporais ou de retenção:
    ```typescript
    // REGRA ESTRITA: Exige que 'dia/dias' esteja precedido de quantificador ou termo de retenção,
    // e NUNCA como parte de palavras como obsidian, diagnostico ou diario.
    const isAgingYardQuery = /\b(\d+\s*dias?|parados?\s*h[aá]|retidos?\s*h[aá]|travados?)\b/i.test(norm) &&
                             /\b(p[aá]tio|oficina|loja)\b/i.test(norm);
    const isPureYardQuery = /\b(no\s+p[aá]tio|na\s+oficina|carros?\s+parados?|ve[ií]culos?\s+parados?)\b/i.test(norm);
    ```
  - Criar novos ramos de classificação semântica prioritária antes das consultas operacionais:
    1. `INTENT_RUNTIME_DIAGNOSTICS`: mensagens como `"o seu obsidian ta funcionando?"`, `"como tá sua memória?"`, `"qual status do bot?"`.
    2. `INTENT_CONVERSATION_HISTORY`: mensagens como `"qual foi a primeira pergunta?"`, `"o que eu perguntei antes?"`.
    3. `INTENT_MEMORY_PREFERENCE`: declarações explícitas de formato/regras como `"prefiro faturamento antes de OS"`.

#### 2. Engine de Diagnóstico Factual (`runtime_diagnostics.ts`)
- Implementar `buildRuntimeDiagnostics(db, phone, persona, lojaSlug)`:
  - Inspeciona diretamente `/home/operacional/hydra-data/vault/usuarios/<phone>/`.
  - Consulta contagem de memórias ativas na tabela `hydra_memories`.
  - Verifica se o processo MCP `hydra-ops` está ativo via ping rápido ou status do conector.
  - Monta balão semântico transparente:
    ```text
    > *Hydra — Diagnóstico de Memória e Conectores*
    - *Obsidian Vault:* Ativo em /vault/usuarios/... (3 notas ativas)
    - *Memória Operacional:* Geração 1 (Sócio — Escopo Rede)
    - *Conector MCP:* Operacional (hydra-ops conectado)
    - *Última Sincronização:* 02/10/2026 às 10:45
    ```
  - Se o vault estiver vazio ou desativado, o balão declara a ausência com honestidade, sem alucinar.

#### 3. Higienização de Prompts (`semantic_prompt.ts` e `system_prompt.md`)
- Remover do `system_prompt.md` contradições entre instruções e exemplos (ex: proibir repetir frases mas ter exemplos repetindo).
- Orientar o revisor crítico a acionar a ferramenta de diagnóstico para indagações sobre o sistema, impedindo que o LLM responda com autodescrições sem evidência.

---

### 3.2 Frente 2 (Executor 2): Vault por Identidade, Armazenamento e Memória
**Sessão Vinculada:** `Hydra Ecosystem Context Transfer` (`7b9923e9-f4d2-46ff-8a6b-ea932132e04d`)

#### 1. Driver do Vault (`vault_manager.ts`)
- **Raiz do Vault:** `/home/operacional/hydra-data/vault/` (configurável via `HYDRA_VAULT_ROOT`).
- **Segurança de Caminho:**
  ```typescript
  function resolveUserVaultPath(phone: string, subPath: string = ''): string {
    const clean = phone.replace(/\D/g, '');
    const userDir = path.resolve(VAULT_ROOT, 'usuarios', clean);
    const target = path.resolve(userDir, subPath);
    if (!target.startsWith(userDir)) {
      throw new Error(`SECURITY_VIOLATION: Tentativa de Path Traversal fora do vault do usuário: ${subPath}`);
    }
    return target;
  }
  ```
- **Gravação Transacional Two-Phase:**
  1. Cria subdiretórios (`preferencias/`, `correcoes/`, `diario/`).
  2. Grava arquivo temporário `.tmp_<timestamp>_<id>.md`.
  3. Realiza `fs.renameSync` atômico para o arquivo final `.md`.
  4. Atualiza o índice no SQLite na tabela `hydra_vault_index`.

#### 2. Tabela SQLite de Índice e Auditoria de Notas (`hydra_vault_index`)
```sql
CREATE TABLE IF NOT EXISTS hydra_vault_index (
  note_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  generation_id INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  loja_slug TEXT,
  topic_key TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  file_hash TEXT NOT NULL,
  last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES hydra_memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_phone_gen ON hydra_vault_index(phone, generation_id, status);
CREATE INDEX IF NOT EXISTS idx_vault_topic ON hydra_vault_index(phone, generation_id, scope_type, loja_slug, topic_key);
```

#### 3. Unificação de Persistência para Sócio e Gerente (`memory_repository.ts`)
- **Extração Universal:** Expor `persistTurnMemoryCandidates(db, candidates, context)` que é chamado tanto no fluxo de Sócio quanto no de Gerente dentro do `agent_dispatcher.ts`.
- **Validação de Evidência Textual Obrigatória:**
  ```typescript
  // A evidência informada pelo modelo DEVE ser uma subsequência ou similar à mensagem real do usuário
  const cleanUserMsg = context.userRawText.toLowerCase();
  const cleanEvidence = candidate.evidenceText.toLowerCase();
  if (!cleanUserMsg.includes(cleanEvidence) && similarity(cleanUserMsg, cleanEvidence) < 0.7) {
    // Rejeita candidato por falta de evidência concreta na mensagem humana
    return { persisted: false, reason: 'EVIDENCE_NOT_IN_USER_MESSAGE' };
  }
  ```
- **Substituição Quíntupla em Correções:**
  ```sql
  -- Substituição restrita: mesmo phone, mesma geração, mesmo escopo e mesma loja!
  SELECT memory_id FROM hydra_memories
  WHERE phone = :phone
    AND generation_id = :generationId
    AND scope_type = :scopeType
    AND (loja_slug = :lojaSlug OR (loja_slug IS NULL AND :lojaSlug IS NULL))
    AND topic_key = :topicKey
    AND status IN ('active', 'candidate');
  ```
- **Dual-Write:** A memória validada é persistida simultaneamente como nota Markdown no vault do usuário e na tabela `hydra_memories` indexada.

---

### 3.3 Frente 3 (Executor 3): Traces Reais, Histórico e Test Harness M01-M18
**Sessão Vinculada:** `Hydra Ecosystem Operational Handover` (`5dffcfaf-5e84-438e-81f0-88558655f4c0`)

#### 1. Consulta Estruturada de Histórico (`conversation_history_service.ts`)
- Atende à pergunta clássica *"qual foi a minha primeira pergunta?"* (Logs 833 e 834).
- Consulta a tabela `conversation_messages` filtrando por `phone` e respeitando a fronteira de sessão/geração:
  ```sql
  SELECT message_id, content, created_at, turn_id
  FROM conversation_messages
  WHERE phone = :phone
    AND role = 'user'
    AND created_at >= :sessionStartTime
  ORDER BY id ASC
  LIMIT 1;
  ```
- Se o usuário perguntar pela primeira pergunta desde o `/reset` ou de todo o histórico, o serviço desambigua ou responde com precisão milimétrica, nunca deduzindo da janela recente de 4 mensagens.

#### 2. Rastreador Real de Ferramentas (`tool_execution_tracker.ts`)
- Substitui a injeção cega de `toolsCalled.push('mcp:hydra-ops')` em `agent_dispatcher.ts:602`.
- O tracker intercepta a chamada real ao worker ou subprocesso MCP. Se o worker apenas sintetizou uma resposta conceitual sem disparar nenhuma tool, `toolsCalled` permanece vazio (`[]`).
- Logs de turno em `agent_interaction_logs` passam a refletir exclusivamente ferramentas que de fato foram executadas.

#### 3. Test Harness M01 a M18 (`test_harness_obsidian_memory.ts`)
- Criação de suíte determinística com 18 cenários de validação (M01 a M18) descritos na Seção 5 da Proposal.
- **Replay Factual dos Turnos 833 a 838:**
  - **Turno 835 Replay:** Pergunta *"o seu obsidian ta funcionando? como tsua memoria"* executada no pipeline corrigido. Asserções:
    * `intent !== 'list_os'` e `intent !== 'aging_cars'`.
    * Resposta NÃO contém placas, veículos ou termos de pátio.
    * Resposta contém dados reais do `runtime_diagnostics` sobre o vault.
  - **Turnos 833/834 Replay:** Pergunta *"qual foi a primeira pergunta?"* devolve a primeira pergunta histórica real do banco, sem contradições.
  - **Turno 838 Replay:** Pergunta *"como ta seu harness?"* resulta em `toolsCalled` sem falsa etiqueta `'mcp:hydra-ops'`.

---

## 4. Matriz de Propriedade de Arquivos (Zero Conflitos)

| Arquivo | Dono Exclusivo | Função na Spec |
|---|:---:|---|
| `src/hydra-sync/types/vault_contract.ts` | **Principal** | Contratos compartilhados congelados de Vault, Diagnóstico e Histórico |
| `src/hydra-sync/intent_rewriter.ts` | **Executor 1** | Remoção de regex espúria `dia`, gramática contextual e classificação semântica |
| `src/hydra-sync/runtime_diagnostics.ts` | **Executor 1** | Provedor de status real do vault, memória, conectores e geração |
| `src/hydra-sync/semantic_prompt.ts` | **Executor 1** | Prompt do revisor para diagnóstico e desambiguação honesta |
| `src/hydra-sync/vault_manager.ts` | **Executor 2** | Driver filesystem do vault, paths seguros, frontmatter e gravação two-phase |
| `src/hydra-sync/memory_repository.ts` | **Executor 2** | Persistência unificada para sócio/gerente, evidência estrita e escopo quíntuplo |
| `src/hydra-sync/memory_retriever.ts` | **Executor 2** | Leitura com pré-filtros limpos de expiração e resolução no vault/SQLite |
| `src/hydra-sync/memory_consolidator.ts` | **Executor 2** | Checkpoints determinísticos e rotinas de consolidação com watermarks |
| `src/hydra-sync/conversation_history_service.ts` | **Executor 3** | Consulta estruturada de primeira pergunta e histórico de turnos |
| `src/hydra-sync/tool_execution_tracker.ts` | **Executor 3** | Interceptação de ferramentas reais sem tags sintéticas |
| `src/hydra-sync/agent_dispatcher.ts` | **Principal / E1** | Integração final de rotas no dispatcher principal |
| `src/hydra-sync/tests/test_harness_obsidian_memory.ts` | **Executor 3** | Suíte integrada dos cenários M01 a M18 e replay dos turnos 833 a 838 |
