# Proposta de Engenharia: Hydra — Histórico de Análises e Grafo de Atendimentos

**ID da Spec:** `hydra-case-history-graph`  
**Data:** 05/10/2026  
**Status:** PLANEJAMENTO FORMALIZADO (VERSÃO 2.1 — REVISADA COM COMPROVAÇÃO SQL A1–A4 E SESSÕES RESTAURADAS)  
**Destinatários e Atribuição de Sessões:**
- **Agente Principal:** Coordenação Central, Arquitetura, Contratos Compartilhados, Verificação de Migração, Integração de Runtime e Gates H01–H18 / R01–R09 / A1–A4.
- **Executor 1 (`de5452f5-ae9d-4de2-af64-0b12f075f5ea`):** Semântica, Autoria e Conteúdo Factual, Distinção Factual de Pátio vs OS, Política de Chegada Parcial de Peças e Versão de Orçamento, Resposta e Capacidades (`conversation_semantic_resolver.ts`, `intent_rewriter.ts`, `os_situation_composer.ts`, `evidence_policy_manager.ts`).
- **Executor 2 (`7b9923e9-f4d2-46ff-8a6b-ea932132e04d`):** Repositório Físico, Migração Segura Multi-Caminho (Banco Vazio, Legado com Pai/Filhos e Migrado), Writer Atômico, Outbox com Claim Token, Limite de Tentativas e Lease, Catálogo Autorizado de Lojas (`real_analysis_repository.ts`, `analysis_memory_writer.ts`, `analysis_projection_outbox.ts`).
- **Executor 3 (`5dffcfaf-5e84-438e-81f0-88558655f4c0`):** Grafo Relacional com Namespace Global (`account_id`), State Reducer Cumulativo com Quantidades e Versão de Orçamento, Recomposição por Edição/Invalidação de Mensagens Antigas, Worker Concorrente com Lease e Proteção de Posse, Leitor Paginado com Fallback e Despacho no Bot (`case_graph_projection.ts`, `case_current_position.ts`, `case_memory_reader.ts`, `hybrid_os_coordinator.ts`, `agent_dispatcher.ts`).

---

## 1. Contexto e Diagnóstico da Auditoria (Ajustes A1 a A4)

Na fase anterior (`hydra-os-conversation-context`), o sistema resolveu localmente a consulta pontual de veículos por modelo e loja (caso Linea/Jabaquara). Na revisão v2, as chaves compostas `(source_id, loja_slug, os_id)` para posição atual e `(revision_id, statement_id)` para afirmações foram testadas com sucesso em SQLite em memória, comprovando que OSs de mesmo número em lojas distintas e o mesmo fato em revisões sucessivas coexistem sem colisão.

Entretanto, as reproduções executadas na conferência de 05/10/2026 (`revisao-grafo-v2-migracao-worker-2026-10-05.md`) revelaram três falhas no SQL proposto e três lacunas de regras de negócio que foram corrigidas nesta especificação:

1. **A1 — Migração com Referências a Tabelas e Colunas Inexistentes:**
   - Em banco vazio, o script anterior falhou com `no such table: hydra_analises_atendimento`.
   - Em banco legado do `RealAnalysisRepository`, falhou com `no such column: revision_id`, pois no SQLite `COALESCE(coluna, ...)` falha na compilação se a coluna não constar na tabela legada.
   - Além disso, a tabela filha `hydra_lacunas_conversa` e a chave estrangeira anterior baseada em `analysis_id` não eram migradas para a nova chave baseada em revisão.
   - **Correção:** O Executor 2 especifica rotina de migração inspecionando dinamicamente a estrutura (`sqlite_schema` e `PRAGMA table_info`), com três caminhos explícitos: (1) Banco vazio; (2) Legado conhecido (migrando pai, afirmações e lacunas sem perda nem invenção de dados); (3) Versão já migrada (idempotente). Proibido `INSERT OR IGNORE` silencioso; contagens de linhas de antes e depois devem coincidir.
2. **A2 — Ordem Inválida do PRAGMA de Foreign Keys:**
   - A proposta executava `PRAGMA foreign_keys = OFF` dentro da transação (`BEGIN IMMEDIATE`). A documentação oficial do SQLite estabelece que alterar `foreign_keys` dentro de uma transação não produz efeito (permanece ativa), o que pode quebrar a reconstrução de tabelas dependentes.
   - **Correção:** Leitura do estado de foreign keys antes da transação, desligamento fora da transação, execução da reconstrução sob `BEGIN IMMEDIATE`, checagem via `PRAGMA foreign_key_check` com rollback em caso de violação, commit e restauração obrigatória do estado inicial de foreign keys fora da transação em bloco `finally`.
3. **A3 — Claim do Outbox Ultrapassando Limite de Tentativas:**
   - O claim anterior executou uma 6ª tentativa para um job com `attempts=5` e `max_attempts=5`.
   - **Correção:** Seleção estrita filtrando `attempts < max_attempts`. Ao atingir o limite, transição imediata para `status = 'FAILED'`.
   - Introdução de **Claim Token unívoco** (`claim_token = randomUUID()`) e lease de 60s. Toda operação de apply, renovação e ack exige o token atual. Se o worker A exceder o lease e o worker B assumir o job com novo token, o worker A é impedido de sobrescrever ou finalizar o job de B.
4. **A4 — Finalização das Três Regras de Negócio Críticas:**
   - **A4.1 (Chegada Parcial e Versão de Orçamento):** Peças exigem rastreamento por vínculo de atendimento/pedido e quantidade inteira (receber 1 de 2 amortecedores deixa 1 pendente). Aprovação de orçamento v1 (`CLIENT_APPROVAL` com `budgetVersion: 'v1'`) não resolve pendência de orçamento v2 (`APPROVAL_DEPENDENCY` com `budgetVersion: 'v2'`).
   - **A4.2 (Edição de Mensagens Antigas e Recomposição Multi-Fonte):** Revisão ou correção de mensagens antigas gera nova revisão que dispara a recomposição (re-redução) cumulativa de todos os fatos do caso, mesmo com timestamp de mensagem anterior. O agregado mantém o conjunto de fontes e revisões aplicadas (`appliedRevisionsMap`), não apenas o maior timestamp escalar.
   - **A4.3 (Namespace Global e Catálogo Oficial de Lojas):**
     - Nós e arestas recebem namespace completo com conta/instância: `node_id = ${entity_type}:${source_id}:${account_id}:${loja_slug}:${entity_local_id}`.
     - A função canônica de elegibilidade de lojas valida contra a whitelist oficial das 10 lojas operacionais de `OFFICIAL_STORES` (`semantic_glossary.ts:55-67`), rejeitando `MPMaster` e qualquer slug desconhecido.

---

## 2. Abordagem Arquitetural Mantida

Mantém-se a abordagem aprovada: **Histórico Canônico Versionado + Grafo Relacional Indexado em SQLite + Redutor de Estado de Posição Atual + Outbox Atômico com Lease e Claim Token**:

| Abordagem | Benefício | Limite / Veto Técnico | Decisão |
| :--- | :--- | :--- | :---: |
| 1. Apenas resumo textual por contato/telefone | Implementação rápida | Mistura múltiplos veículos/OSs do mesmo telefone; perde autoria e evidências; falha em casos complexos | ❌ **Rejeitado** |
| **2. Histórico Canônico + Grafo Relacional + Redutor de Estado + Outbox com Lease** | **Linha do tempo exata, rastreabilidade de fatos, separação de OSs, suporte pré-OS, recuperação de workers e zero reanálise** | Exige migração versionada inspecionada e claims com token | ✅ **ADOTADO E REFINADO** |
| 3. Grafo de mensagens brutas completo | Conteúdo integral no grafo | Custo proibitivo de ingestão, risco grave de LGPD/privacidade e latência inaceitável no bot | ❌ **Rejeitado** |

---

## 3. Contratos Compartilhados Especificados

Congelados em `src/hydra-sync/types/conversation_context_contract.ts`:

```typescript
/**
 * Escopo de Caso Empresarial discriminando casos com OS de atendimentos pré-OS.
 */
export type BusinessCaseScope =
  | {
      readonly targetType: 'ORDER';
      readonly sourceId: string;
      readonly accountId: string;
      readonly lojaSlug: string;
      readonly osId: number;
      readonly vehiclePlate?: string;
      readonly customerPhone?: string;
    }
  | {
      readonly targetType: 'PRE_ORDER';
      readonly sourceId: string;
      readonly accountId: string;
      readonly lojaSlug: string;
      readonly conversationId: string | number;
      readonly customerPhone?: string;
      readonly candidatePlate?: string;
    };

/**
 * Identidade Unívoca da Revisão da Análise.
 */
export interface AnalysisRevisionIdentity {
  readonly sourceId: string;
  readonly accountId: string;
  readonly conversationId: string | number;
  readonly analysisRunId: string;
  readonly revisionId: string; // Formato: `${sourceId}:${accountId}:${conversationId}:${analysisRunId}`
  readonly schemaVersion: string;
  readonly analyzerVersion: string;
}

/**
 * Estrutura de Peça com Quantidade e Vínculo de Pedido.
 */
export interface PartItemReference {
  readonly partName: string;
  readonly partCode?: string;
  readonly quantityRequested: number;
  readonly quantityArrived: number;
  readonly orderRef?: string;
  readonly serviceScope?: string;
}

/**
 * Fato Operacional Estruturado com Identidade Estável, Versão de Orçamento e Quantidades.
 */
export interface ExtractedStatement {
  readonly statementId: string;
  readonly factId: string;
  readonly revisionId: string;
  readonly subject: OperationalStatementSubject;
  readonly polarity: 'AFFIRMATIVE' | 'NEGATIVE' | 'CONDITIONAL';
  readonly authorRole: 'CLIENT' | 'ATTENDANT' | 'SYSTEM' | 'UNKNOWN';
  readonly authorName: string;
  readonly messageId: number | null; // Nulo para legados sem ID individual
  readonly timestamp: string;
  readonly rawExcerpt: string;
  readonly targetOsId?: number;
  readonly serviceScope?: string;
  readonly budgetVersion?: string;   // Ex: 'v1', 'v2'
  readonly monetaryCents?: number;   // Centavos inteiros
  readonly delayCauseReported?: string;
  readonly partReference?: PartItemReference;
  readonly supersedesFactId?: string;
  readonly confirmation: 'EXPLICIT_CONFIRMED' | 'AMBIGUOUS_GENERIC' | 'CLAIM_UNCONFIRMED' | 'REFUTED_SUPERSEDED';
}

/**
 * Posição Atual Compacta Derivada por State Reducer.
 */
export interface CaseCurrentPosition {
  readonly sourceId: string;
  readonly accountId: string;
  readonly lojaSlug: string;
  readonly osId: number;
  readonly vehiclePlate: string;
  readonly vehicleModel: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly currentErpStatus: string;
  readonly erpSnapshotTimestamp: string;
  readonly approvalStatus: 'PENDING' | 'APPROVED' | 'REFUSED' | 'UNKNOWN';
  readonly approvedBudgetVersion?: string;
  readonly pendingBudgetVersion?: string;
  readonly reportedDelay?: {
    readonly cause: string;
    readonly authorName: string;
    readonly authorRole: string;
    readonly reportedAt: string;
    readonly rawExcerpt: string;
  };
  readonly activePartDependencies: readonly {
    readonly factId: string;
    readonly partName: string;
    readonly partCode?: string;
    readonly quantityPending: number;
    readonly orderRef?: string;
    readonly requestedAt: string;
  }[];
  readonly latestCommitments: readonly string[];
  readonly activeGaps: readonly ConversationGap[];
  readonly lastCoveredTimestamp: string;
  readonly appliedRevisionsMap: Record<string, string>; // Mapa de source/conversa -> revisionId
  readonly projectionVersion: number;
}
```

---

## 4. Matriz Unificada de Gates e Testes (G01–G15 / H01–H18 / R01–R09 / A1–A4)

1. **G01–G15:** Preservação integral dos gates herdados de consulta Linea/Jabaquara e contexto de OS.
2. **H01–H18:** Gates arquiteturais do adendo do grafo:
   - **H12:** Modo padrão com histórico disponível realiza exatamente zero leitura bruta de mensageria e zero reanálise.
   - **H17:** Idade da OS calculada via `openedAt`/ERP no fuso `America/Sao_Paulo`; veto a "carro no pátio" e à cópia cega de "9 dias".
   - **H18:** Ranking operacional exclui compulsoriamente a loja administrativa `MPMaster` e slugs não cadastrados.
3. **R01–R09:** Testes de identidade composta, outbox e integridade:
   - **R01:** Coexistência de mesmo `os_id` em lojas distintas e mesmo fato em revisões sucessivas.
   - **R09:** Demonstração do percurso completo do produtor real até o bot servido, quando a implantação estiver autorizada.
4. **A1–A4 (Novos Testes Obrigatórios da Revisão v2):**
   - **A1:** Migração segura em banco vazio (criação direta), banco legado populado (preservando pais, afirmações e lacunas sem perda) e banco já migrado (no-op idempotente). Rollback seguro em caso de falha.
   - **A2:** `foreign_keys = OFF` executado fora da transação; `foreign_key_check` valida integridade com filhos sintéticos; restauração de FKs no `finally`.
   - **A3:** Limite estrito de 5 tentativas respeitado no claim; estado terminal `FAILED` visível; Claim Token único de 60s; worker A pausado não sobrescreve job assumido por worker B.
   - **A4:** Chegada parcial deixa saldo de peças pendente; aprovação de orçamento v1 não resolve dependência de v2; mensagem antiga editada dispara recomposição do caso; node_id com `account_id` isola contas de mensageria com mesmo número; slug não cadastrado é rejeitado pelo validador de elegibilidade.
