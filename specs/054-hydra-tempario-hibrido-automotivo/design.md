# Spec 054 — Design Técnico Refinado: Tempário Híbrido Automotivo (RAG Vetorial + Grafo de Dependências + Tempo Real de Pátio)

**ID da Spec:** `054-hydra-tempario-hibrido-automotivo`  
**Versão:** 2.0 (Refinada com contratos reais de `src/hydra-sync/`)  
**Data:** 03/11/2026  
**Status:** PROPOSTA / RFC PRONTA PARA VALIDAÇÃO  
**Stack:** TypeScript 5.x Strict (zero `any`, zero `@ts-ignore`), Node.js 22 LTS, `better-sqlite3`, `sqlite-vec` (384d), `@huggingface/transformers`

---

## 1. Arquitetura e Fluxo de Dados End-to-End

```mermaid
flowchart TD
    InMsg["Ingress: Mensagem WhatsApp / Chatwoot / CallTool MCP"] --> AccessGuard["IdentityAccessGuard & ManagerStoreAccess"]
    AccessGuard -->|Contexto Autorizado: persona + effectiveLojaSlug| Dispatcher["AgentDispatcher & IntentRewriter"]

    Dispatcher -->|Guard: !isExplicitFinancialQuery & isTemparioQuery| PlanBuilder["SemanticPlanBuilder (TEMPARIO_TEMPO_SERVICO)"]
    PlanBuilder --> Coord["TemparioHybridCoordinator"]

    Coord --> Step1{"Passo 1: Cache L1 Hit? (ConversationCacheManager)"}
    Step1 -->|HIT (< 5ms)| Composer["BalloonComposer (Padrão Hermes Nativo)"]

    Step1 -->|MISS| Step2["Passo 2: Busca Híbrida RRF (TemparioVector + HybridRetrieval)"]
    Step2 --> SqlFilter["Filtro SQL Exato (Marca / Modelo / Ano / Motor)"]
    Step2 --> FtsSearch["SQLite FTS5 (tempario_fts + escapeFtsQuery)"]
    Step2 --> VecSearch["sqlite-vec KNN 384d (vec_tempario_chunks + getEmbedder)"]
    SqlFilter & FtsSearch & VecSearch --> RrfFusion["Reciprocal Rank Fusion (RRF k=60)"]

    RrfFusion --> Step3["Passo 3: TemparioGraphRepository (WITH RECURSIVE CTE)"]
    Step3 --> TopoSort["Travessia Multi-Salto + Anti-Ciclo + Deduplicação DEPENDE_ACESSO"]

    TopoSort --> Step4["Passo 4: OperationalDataRepository + CaseMemoryReader"]
    Step4 --> YardCross["Cruzamento OSs Reais (data_inicio_iso / data_fim_iso) + Gargalos Fatuais"]

    YardCross --> Step5{"Passo 5: Confiança >= 0.75 e Fonte Homologada?"}
    Step5 -->|SIM| CacheWrite["Grava Cache Multi-Fatorial"]
    CacheWrite --> Composer

    Step5 -->|NÃO (< 0.75)| Step6["Passo 6: Fallback Controlado (EvidencePolicyManager)"]
    Step6 --> Quarantine["Grava em tempario_external_estimates_staging + VaultNote"]
    Quarantine --> Composer

    Composer --> Guard["PublicResponseGuard (validateAndSanitizePublicResponse)"]
    Guard --> Egress["Despacho WhatsApp (instância hydra) / Retorno Tool MCP"]
```

---

## 2. DDL Exato das Tabelas SQLite (`src/hydra-sync/db_repository.ts`)

A função `ensureTemparioTables(db: Database.Database): void` será invocada de forma idempotente na inicialização de `getDatabaseConnection()` em `db_repository.ts` (logo após `ensureCaseAnalysisTables(db)`).

> [!IMPORTANT]
> **Modelagem Polimórfica de Arestas:** Na tabela `tempario_dependencies_edges`, o nó de origem (`from_node_id` com `from_node_type IN ('OPERATION', 'SUBOP')`) permite tanto vincular uma operação às suas etapas diretas (`TEM_SUBOP`) quanto encadear sub-operações que dependem fisicamente de outras sub-operações (`SubOp A -> DEPENDE_ACESSO -> SubOp B`), sem violar `PRAGMA foreign_keys = ON`.

```sql
-- 1. Catálogo de Veículos (Marca, Modelo, Geração e Faixa de Ano)
CREATE TABLE IF NOT EXISTS tempario_vehicles (
  vehicle_id TEXT PRIMARY KEY,             -- Ex: 'vw_golf_mk7_2014_2021'
  marca TEXT NOT NULL,                     -- Ex: 'Volkswagen'
  modelo TEXT NOT NULL,                    -- Ex: 'Golf'
  geracao TEXT,                            -- Ex: 'MK7 / MK7.5'
  ano_inicio INTEGER NOT NULL,             -- Ex: 2014
  ano_fim INTEGER NOT NULL,                -- Ex: 2021
  categoria TEXT NOT NULL DEFAULT 'PASSEIO' CHECK (categoria IN ('PASSEIO', 'SUV', 'UTILITARIO', 'PREMIUM')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tempario_vehicles_lookup
  ON tempario_vehicles(LOWER(marca), LOWER(modelo), ano_inicio, ano_fim);

-- 2. Variantes de Motorização (Relação VARIA_POR_MOTOR)
CREATE TABLE IF NOT EXISTS tempario_engines (
  engine_id TEXT PRIMARY KEY,              -- Ex: 'vw_ea211_14_tsi'
  vehicle_id TEXT NOT NULL,                -- FK -> tempario_vehicles(vehicle_id)
  codigo_motor TEXT NOT NULL,              -- Ex: 'EA211'
  cilindrada TEXT NOT NULL,                -- Ex: '1.4'
  descricao_comercial TEXT NOT NULL,       -- Ex: '1.4 16V TSI Turbo'
  combustivel TEXT NOT NULL DEFAULT 'FLEX' CHECK (combustivel IN ('FLEX', 'GASOLINA', 'DIESEL', 'HIBRIDO', 'ELETRICO')),
  aspiracao TEXT NOT NULL DEFAULT 'TURBO' CHECK (aspiracao IN ('ASPIRADO', 'TURBO', 'BITURBO', 'SUPERCHARGED')),
  valvulas INTEGER NOT NULL DEFAULT 16,
  FOREIGN KEY (vehicle_id) REFERENCES tempario_vehicles(vehicle_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tempario_engines_vehicle
  ON tempario_engines(vehicle_id, codigo_motor);

-- 3. Fontes de Evidência Técnica (Relação FONTE_EVIDENCIA — Cláusula Anti-Alucinação)
CREATE TABLE IF NOT EXISTS tempario_evidence_sources (
  source_id TEXT PRIMARY KEY,              -- Ex: 'src_vw_elsapro_golf_mk7_gr94'
  tipo_fonte TEXT NOT NULL CHECK (tipo_fonte IN ('MANUAL_OEM', 'BOLETIM_TSB', 'HISTORICO_OS_REDE', 'ESTIMATIVA_EXTERNA')),
  status_evidencia TEXT NOT NULL CHECK (status_evidencia IN ('HOMOLOGADO_OEM', 'HISTORICO_OS_REDE', 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO')),
  nome_documento TEXT NOT NULL,            -- Ex: 'Manual Oficial de Reparações VW ElsaPro / Elwin — Golf MK7'
  versao_revisao TEXT,                     -- Ex: 'Edição 08.2020'
  capitulo_secao TEXT,                     -- Ex: 'Grupo 94 — Sistema de Iluminação Externa'
  pagina_tabela TEXT,                      -- Ex: 'Seção 94-1 / Operação 94151900'
  hash_integridade_sha256 TEXT,
  homologado_por TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Operações de Manutenção (Serviços Comercializáveis)
CREATE TABLE IF NOT EXISTS tempario_operations (
  operation_id TEXT PRIMARY KEY,           -- Ex: 'op_vw_golf_14tsi_troca_farol_esq'
  codigo_operacao_oem TEXT NOT NULL,       -- Ex: '9415-1900-ESQ'
  vehicle_id TEXT NOT NULL,                -- FK -> tempario_vehicles(vehicle_id)
  engine_id TEXT,                          -- FK -> tempario_engines(engine_id) (NULL se independe de motor)
  titulo TEXT NOT NULL,                    -- Ex: 'Substituição do Farol Dianteiro Esquerdo'
  sinonimos_busca TEXT NOT NULL,           -- Ex: 'trocar farol esquerdo, troca bloco optico dianteiro, farol golf'
  categoria_servico TEXT NOT NULL,         -- Ex: 'ELETRICA_ILUMINACAO', 'ARREFECIMENTO', 'MOTOR', 'SUSPENSAO', 'FREIOS'
  tempo_padrao_bruto_horas REAL NOT NULL,  -- Soma bruta sem desconto de compartilhamento (ex: 1.40)
  fator_variacao_motor REAL NOT NULL DEFAULT 1.0, -- Multiplicador VARIA_POR_MOTOR
  grau_dificuldade TEXT NOT NULL DEFAULT 'MEDIO' CHECK (grau_dificuldade IN ('BAIXO', 'MEDIO', 'ALTO', 'ESPECIALISTA')),
  source_id TEXT NOT NULL,                 -- FK -> tempario_evidence_sources(source_id)
  status_evidencia TEXT NOT NULL CHECK (status_evidencia IN ('HOMOLOGADO_OEM', 'HISTORICO_OS_REDE')),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES tempario_vehicles(vehicle_id),
  FOREIGN KEY (engine_id) REFERENCES tempario_engines(engine_id),
  FOREIGN KEY (source_id) REFERENCES tempario_evidence_sources(source_id)
);

CREATE INDEX IF NOT EXISTS idx_tempario_ops_vehicle_cat
  ON tempario_operations(vehicle_id, engine_id, categoria_servico);

-- 5. Sub-operações Atômicas (Nós de Etapa e Acesso)
CREATE TABLE IF NOT EXISTS tempario_suboperations (
  subop_id TEXT PRIMARY KEY,               -- Ex: 'sub_vw_golf_mk7_remover_parachoque_diant'
  codigo_etapa TEXT NOT NULL,              -- Ex: '6310-1900'
  titulo TEXT NOT NULL,                    -- Ex: 'Remover para-choque dianteiro'
  descricao_tecnica TEXT NOT NULL,         -- Ex: 'Soltar fixadores Torx T25 nos para-lamas, grade superior e defletor inferior.'
  fase_execucao TEXT NOT NULL CHECK (fase_execucao IN ('DESMONTAGEM', 'EXECUCAO', 'REMONTAGEM', 'TESTE_AJUSTE')),
  tempo_horas REAL NOT NULL,               -- Ex: 0.40 (24 min)
  ferramentas_json TEXT NOT NULL DEFAULT '[]', -- Relação USAR_FERRAMENTA: '["Chave Torx T25", "Espátula de nylon"]'
  torque_especificado TEXT,                -- Ex: 'Parafusos suporte farol: 8 Nm'
  is_acesso_compartilhado INTEGER NOT NULL DEFAULT 0 -- 1 quando etapa é compartilhável entre múltiplos serviços
);

-- 6. Arestas de Dependência do Grafo (TEM_SUBOP, DEPENDE_ACESSO, POS_REQUISITO)
CREATE TABLE IF NOT EXISTS tempario_dependencies_edges (
  edge_id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,              -- operation_id (quando from_node_type='OPERATION') ou subop_id (quando 'SUBOP')
  from_node_type TEXT NOT NULL CHECK (from_node_type IN ('OPERATION', 'SUBOP')),
  to_subop_id TEXT NOT NULL,               -- FK -> tempario_suboperations(subop_id)
  relation_type TEXT NOT NULL CHECK (relation_type IN ('TEM_SUBOP', 'DEPENDE_ACESSO', 'USAR_FERRAMENTA', 'VARIA_POR_MOTOR', 'FONTE_EVIDENCIA', 'POS_REQUISITO')),
  ordem_local INTEGER NOT NULL,            -- Ordem cronológica dentro da fase (10, 20, 30...)
  obrigatorio INTEGER NOT NULL DEFAULT 1,
  condicao_motor_id TEXT,                  -- Opcional: aresta só ativa para determinado motor (VARIA_POR_MOTOR)
  FOREIGN KEY (to_subop_id) REFERENCES tempario_suboperations(subop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tempario_edges_from
  ON tempario_dependencies_edges(from_node_type, from_node_id, ordem_local);
CREATE INDEX IF NOT EXISTS idx_tempario_edges_to
  ON tempario_dependencies_edges(to_subop_id);

-- 7. Chunks de Procedimentos Técnicos para RAG Híbrido (FTS5 + sqlite-vec)
CREATE TABLE IF NOT EXISTS tempario_procedure_chunks (
  chunk_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  engine_id TEXT,
  source_id TEXT NOT NULL,
  titulo_contexto TEXT NOT NULL,
  conteudo_texto TEXT NOT NULL,
  metadados_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operation_id) REFERENCES tempario_operations(operation_id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES tempario_vehicles(vehicle_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES tempario_evidence_sources(source_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS tempario_fts USING fts5(
  chunk_id UNINDEXED,
  operation_id UNINDEXED,
  titulo_contexto,
  conteudo_texto,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- 8. Quarentena de Estimativas Externas (Isolamento Anti-Contaminação)
CREATE TABLE IF NOT EXISTS tempario_external_estimates_staging (
  estimate_id TEXT PRIMARY KEY,
  veiculo_informado TEXT NOT NULL,
  motor_informado TEXT,
  ano_informado INTEGER,
  servico_solicitado TEXT NOT NULL,
  tempo_estimado_horas REAL NOT NULL,
  passos_inferidos_json TEXT NOT NULL,
  status_evidencia TEXT NOT NULL DEFAULT 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'
    CHECK (status_evidencia = 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'),
  requested_by_phone TEXT,
  loja_slug TEXT,
  confidence_score REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

E quando `loadVectorExtension(db)` (`db_repository.ts`) estiver ativo:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_tempario_chunks USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding float[384]
);
```

---

## 3. Query `WITH RECURSIVE` de Travessia e Deduplicação de Sub-operações (`DEPENDE_ACESSO`)

### 3.1. Caso Canônico 1 — Serviço Único (`Trocar Farol Esquerdo — VW Golf 1.4 TSI 2020`)
O grafo resolve a cadeia em 6 passos ordenados:
1. `Remover para-choque dianteiro` (`DESMONTAGEM`, `0,40h` / `24 min`)
2. `Desconectar chicote elétrico principal` (`DESMONTAGEM`, `0,10h` / `6 min`)
3. `Remover suporte de fixação do farol` (`DESMONTAGEM`, `0,20h` / `12 min`)
4. `Substituir bloco óptico / lâmpada do farol esquerdo` (`EXECUCAO`, `0,20h` / `12 min`)
5. `Recolocar suporte e reinstalar para-choque dianteiro` (`REMONTAGEM`, `0,35h` / `21 min`)
6. `Testar funcionamento e alinhar facho óptico` (`TESTE_AJUSTE`, `0,15h` / `9 min`)
- **Total Líquido:** `1,40h` (`84 min`).

### 3.2. Caso Canônico 2 — Múltiplos Serviços com Pré-requisito Compartilhado (`Trocar Farol Esquerdo` + `Trocar Radiador`)
Ambos os serviços dependem fisicamente de `Remover para-choque dianteiro` (`0,40h`) e `Recolocar para-choque dianteiro` (`0,25h`). O CTE recursivo percorre as dependências `TEM_SUBOP` e `DEPENDE_ACESSO`, previne ciclos via `path_visited` e deduplica por `subop_id`:

```sql
WITH RECURSIVE graph_traversal AS (
  -- Âncora: Sub-operações diretas das operações solicitadas
  SELECT
    e.from_node_id AS root_operation_id,
    e.to_subop_id AS subop_id,
    e.relation_type,
    e.ordem_local,
    1 AS profundidade,
    '|' || e.to_subop_id || '|' AS path_visited
  FROM tempario_dependencies_edges e
  WHERE e.from_node_type = 'OPERATION'
    AND e.from_node_id IN (SELECT value FROM json_each(:operationIdsJson))
    AND (e.condicao_motor_id IS NULL OR e.condicao_motor_id = :engineId)

  UNION ALL

  -- Passo Recursivo: Pré-requisitos físicos encadeados (SubOp -> DEPENDE_ACESSO / POS_REQUISITO -> SubOp)
  SELECT
    gt.root_operation_id,
    e2.to_subop_id AS subop_id,
    e2.relation_type,
    e2.ordem_local,
    gt.profundidade + 1 AS profundidade,
    gt.path_visited || e2.to_subop_id || '|' AS path_visited
  FROM graph_traversal gt
  INNER JOIN tempario_dependencies_edges e2
    ON e2.from_node_type = 'SUBOP'
   AND e2.from_node_id = gt.subop_id
  WHERE gt.profundidade < 12
    AND instr(gt.path_visited, '|' || e2.to_subop_id || '|') = 0
    AND (e2.condicao_motor_id IS NULL OR e2.condicao_motor_id = :engineId)
),
raw_occurrences AS (
  SELECT
    gt.root_operation_id,
    s.subop_id,
    s.codigo_etapa,
    s.titulo,
    s.descricao_tecnica,
    s.fase_execucao,
    s.tempo_horas,
    s.ferramentas_json,
    s.torque_especificado,
    s.is_acesso_compartilhado,
    MIN(gt.ordem_local) AS menor_ordem_local,
    MAX(gt.profundidade) AS maior_profundidade
  FROM graph_traversal gt
  INNER JOIN tempario_suboperations s ON s.subop_id = gt.subop_id
  GROUP BY gt.root_operation_id, s.subop_id
),
gross_totals AS (
  SELECT COALESCE(SUM(tempo_horas), 0.0) AS tempo_bruto_sem_deduplicacao
  FROM raw_occurrences
),
deduplicated_chain AS (
  SELECT
    ro.subop_id,
    ro.codigo_etapa,
    ro.titulo,
    ro.descricao_tecnica,
    ro.fase_execucao,
    ro.tempo_horas,
    ro.ferramentas_json,
    ro.torque_especificado,
    ro.is_acesso_compartilhado,
    COUNT(DISTINCT ro.root_operation_id) AS qtd_servicos_compartilhando,
    GROUP_CONCAT(DISTINCT ro.root_operation_id) AS operacoes_origem_csv,
    CASE ro.fase_execucao
      WHEN 'DESMONTAGEM' THEN 1
      WHEN 'EXECUCAO'    THEN 2
      WHEN 'REMONTAGEM'  THEN 3
      WHEN 'TESTE_AJUSTE' THEN 4
      ELSE 5
    END AS ordem_fase,
    -- Na DESMONTAGEM, pré-requisitos mais profundos (ex: para-choque) vêm ANTES do item interno (profundidade DESC)
    CASE
      WHEN ro.fase_execucao = 'DESMONTAGEM' THEN -MAX(ro.maior_profundidade)
      ELSE MIN(ro.maior_profundidade)
    END AS criterio_profundidade,
    MIN(ro.menor_ordem_local) AS criterio_ordem_local
  FROM raw_occurrences ro
  GROUP BY ro.subop_id
)
SELECT
  ROW_NUMBER() OVER (
    ORDER BY dc.ordem_fase ASC, dc.criterio_profundidade ASC, dc.criterio_ordem_local ASC, dc.subop_id ASC
  ) AS ordem_execucao_final,
  dc.subop_id,
  dc.codigo_etapa,
  dc.titulo,
  dc.descricao_tecnica,
  dc.fase_execucao,
  ROUND(dc.tempo_horas, 2) AS tempo_horas,
  CAST(ROUND(dc.tempo_horas * 60) AS INTEGER) AS tempo_minutos,
  dc.ferramentas_json,
  dc.torque_especificado,
  dc.is_acesso_compartilhado,
  dc.qtd_servicos_compartilhando,
  dc.operacoes_origem_csv,
  ROUND((SELECT SUM(tempo_horas) FROM deduplicated_chain), 2) AS tempo_liquido_total_horas,
  ROUND((SELECT tempo_bruto_sem_deduplicacao FROM gross_totals), 2) AS tempo_bruto_total_horas,
  ROUND(
    (SELECT tempo_bruto_sem_deduplicacao FROM gross_totals) - (SELECT SUM(tempo_horas) FROM deduplicated_chain),
    2
  ) AS tempo_economizado_deduplicacao_horas
FROM deduplicated_chain dc
ORDER BY ordem_execucao_final ASC;
```

---

## 4. Interfaces TypeScript Completas (`src/hydra-sync/types/tempario_contract.ts`)

Zero `any`, zero `@ts-ignore`, 100% compatível com `tsconfig.json` strict:

```typescript
/**
 * src/hydra-sync/types/tempario_contract.ts
 * Contratos Estritos do Subsistema de Tempário Híbrido Automotivo (Spec 054).
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import type { SecurityContext } from './conversation_context_contract.js';

export type TemparioEvidenceStatus =
  | 'HOMOLOGADO_OEM'
  | 'HISTORICO_OS_REDE'
  | 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO';

export type TemparioSourceType =
  | 'MANUAL_OEM'
  | 'BOLETIM_TSB'
  | 'HISTORICO_OS_REDE'
  | 'ESTIMATIVA_EXTERNA';

export type ExecutionPhase =
  | 'DESMONTAGEM'
  | 'EXECUCAO'
  | 'REMONTAGEM'
  | 'TESTE_AJUSTE';

export type TemparioRelationType =
  | 'TEM_SUBOP'
  | 'DEPENDE_ACESSO'
  | 'USAR_FERRAMENTA'
  | 'VARIA_POR_MOTOR'
  | 'FONTE_EVIDENCIA'
  | 'POS_REQUISITO';

export type TemparioDifficulty = 'BAIXO' | 'MEDIO' | 'ALTO' | 'ESPECIALISTA';

export interface TemparioVehicleRecord {
  readonly vehicleId: string;
  readonly marca: string;
  readonly modelo: string;
  readonly geracao?: string;
  readonly anoInicio: number;
  readonly anoFim: number;
  readonly categoria: 'PASSEIO' | 'SUV' | 'UTILITARIO' | 'PREMIUM';
}

export interface TemparioEngineRecord {
  readonly engineId: string;
  readonly vehicleId: string;
  readonly codigoMotor: string;
  readonly cilindrada: string;
  readonly descricaoComercial: string;
  readonly combustivel: 'FLEX' | 'GASOLINA' | 'DIESEL' | 'HIBRIDO' | 'ELETRICO';
  readonly aspiracao: 'ASPIRADO' | 'TURBO' | 'BITURBO' | 'SUPERCHARGED';
  readonly valvulas: number;
}

export interface TemparioEvidenceSourceRecord {
  readonly sourceId: string;
  readonly tipoFonte: TemparioSourceType;
  readonly statusEvidencia: TemparioEvidenceStatus;
  readonly nomeDocumento: string;
  readonly versaoRevisao?: string;
  readonly capituloSecao?: string;
  readonly paginaTabela?: string;
  readonly homologadoPor?: string;
}

export interface TemparioSubOperationStep {
  readonly ordemExecucaoFinal: number;
  readonly subopId: string;
  readonly codigoEtapa: string;
  readonly titulo: string;
  readonly descricaoTecnica: string;
  readonly faseExecucao: ExecutionPhase;
  readonly tempoHoras: number;
  readonly tempoMinutos: number;
  readonly ferramentas: readonly string[];
  readonly torqueEspecificado?: string;
  readonly isAcessoCompartilhado: boolean;
  readonly qtdServicosCompartilhando: number;
  readonly operacoesOrigemIds: readonly string[];
}

export interface TemparioOperationRecord {
  readonly operationId: string;
  readonly codigoOperacaoOem: string;
  readonly vehicleId: string;
  readonly engineId?: string;
  readonly titulo: string;
  readonly categoriaServico: string;
  readonly tempoPadraoBrutoHoras: number;
  readonly fatorVariacaoMotor: number;
  readonly grauDificuldade: TemparioDifficulty;
  readonly sourceId: string;
  readonly statusEvidencia: TemparioEvidenceStatus;
}

export interface DeduplicatedGraphChainResult {
  readonly steps: readonly TemparioSubOperationStep[];
  readonly tempoLiquidoTotalHoras: number;
  readonly tempoLiquidoTotalMinutos: number;
  readonly tempoBrutoTotalHoras: number;
  readonly tempoEconomizadoDeduplicacaoHoras: number;
  readonly tempoEconomizadoDeduplicacaoMinutos: number;
  readonly possuiDeduplicacaoAtiva: boolean;
}

export interface StoreYardServiceSample {
  readonly lojaSlug: string;
  readonly qtdOsEncerradas: number;
  readonly tempoMedioExecucaoHoras: number;
  readonly leadTimeMedioPatioDias: number;
}

export interface YardRealTimeComparison {
  readonly temHistoricoRede: boolean;
  readonly escopoAplicado: 'REDE_10_LOJAS' | 'LOJA_ISOLADA';
  readonly lojaFiltroSlug?: string;
  readonly totalOsAnalisadas: number;
  readonly tempoMedioExecucaoHoras: number | null;
  readonly tempoMedioExecucaoMinutos: number | null;
  readonly medianaExecucaoHoras: number | null;
  readonly leadTimeMedioPatioDias: number | null;
  readonly desvioContraTabeladoPct: number | null;
  readonly gargalosFatuaisComprovados: readonly string[];
  readonly declaracaoLimitacaoFactual: string;
  readonly distribuicaoPorLoja: readonly StoreYardServiceSample[];
}

export interface TemparioHybridQueryInput {
  readonly rawQuery: string;
  readonly veiculoMarcaModelo: string;
  readonly ano?: number;
  readonly motorTexto?: string;
  readonly servicosSolicitados: readonly string[];
  readonly securityContext: SecurityContext;
  readonly turnId?: string;
  readonly generationId?: number;
}

export interface TemparioHybridQueryResponse {
  readonly queryId: string;
  readonly isCacheHit: boolean;
  readonly latencyMs: number;
  readonly confidenceScore: number;
  readonly retrievalMethod: 'CACHE_L1' | 'HYBRID_RRF_GRAPH' | 'FTS5_GRAPH_FALLBACK' | 'ASSISTED_EXTERNAL_ESTIMATE';
  readonly veiculo: TemparioVehicleRecord | null;
  readonly motor: TemparioEngineRecord | null;
  readonly operacoesResolvidas: readonly TemparioOperationRecord[];
  readonly cadeiaExecucao: DeduplicatedGraphChainResult;
  readonly comparativoPatio: YardRealTimeComparison;
  readonly evidenciasFontes: readonly TemparioEvidenceSourceRecord[];
  readonly statusEvidenciaGlobal: TemparioEvidenceStatus;
  readonly avisoQuarentena?: string;
}
```

---

## 5. Integração Exata com os Módulos Existentes em `src/hydra-sync/`

### 5.1. `src/hydra-sync/tempario_vector.ts` + `src/hydra-sync/hybrid_retrieval.ts`
- Reutiliza `getEmbedder()` de `./embeddings.js` e `escapeFtsQuery()` de `./hybrid_retrieval.js`.
- Função `searchTemparioHybridRRF(db, params)`:
  1. Executa filtro SQL estruturado em `tempario_vehicles` e `tempario_engines` (marca, modelo, janela `ano_inicio <= :ano AND ano_fim >= :ano`).
  2. Executa busca lexical em `tempario_fts` usando `escapeFtsQuery(servicoTerm)`.
  3. Se `loadVectorExtension(db)` e `getEmbedder()` estiverem ativos, gera vetor 384d (`Float32Array`) e consulta `vec_tempario_chunks` (`WHERE embedding MATCH ? ORDER BY distance LIMIT 20`).
  4. Combina os rankings via Reciprocal Rank Fusion ($k=60$, $w_{\text{vec}}=1.0$, $w_{\text{fts}}=1.0$, bônus exato de veículo $+0.25$) e normaliza o `confidenceScore` em $[0.0, 1.0]$.

### 5.2. `src/hydra-sync/operational_data_repository.ts`
- Nova função `getYardHistoricalServiceMetrics(db, options)`:
  - Respeita `SecurityContext`: se `securityContext.persona === 'gerente'`, exige `securityContext.lojaSlug` e injeta obrigatoriamente `AND os.loja_slug = ?` (lançando `SecurityAccessDeniedError` se ausente).
  - Expurga `MPMaster` (`AND os.loja_slug != 'MPMaster'`).
  - Consulta OSs validadas (`qualidade_dado = 'VALIDADO'`) usando `data_inicio_iso` e `data_fim_iso` (convertidas com `parseBrDateToIso` de `db_repository.ts`) e inspeciona os itens de serviço do `raw_payload` (`isServiceItem`).
  - Consulta causas de demora documentadas em `hydra_case_current_position` / `hydra_afirmacoes_analisadas` para as OSs casadas e passa pelo `EvidencePolicyManager.evaluateDelayCause` para jamais inventar gargalos sem registro factual.

### 5.3. `src/hydra-sync/tempario_hybrid_coordinator.ts`
- Orquestra os 4 passos:
  - **Cache L1:** Usa chave canônica `hydra:tempario:v1:${veiculoSlug}:${ano || 'any'}:${motorSlug}:${servicosHash}:${persona}:${effectiveLojaSlug}:${generationId}`.
  - **Grafo & Vetor:** Se `confidenceScore >= 0.75` e `operacoesResolvidas.length > 0`, executa `getServiceChainWithDeduplication(db, operationIds, engineId)`.
  - **Fallback Seguro (`confidenceScore < 0.75`):**
    - Proíbe fabricar `capituloSecao` ou `paginaTabela` de manual OEM.
    - Registra a estimativa em `tempario_external_estimates_staging` com `status_evidencia = 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'`.
    - Registra evidência de cobertura parcial via `upsertTableEvidence(db, ...)` em `evidence_repository.ts`.

### 5.4. `src/hydra-sync/intent_rewriter.ts`, `src/hydra-sync/agent_dispatcher.ts` e `src/hydra-sync/manager_store_access.ts`
- **`semantic_glossary.ts`:** Adiciona categoria e termos canônicos de tempário (`tempario`, `tempo de mao de obra`, `tempo tabelado`, `sub-operacoes`, `horas de servico`, `quanto tempo leva pra trocar`).
- **`intent_rewriter.ts`:** Adiciona detector `isTemparioTechnicalQuery(norm)` que emite `intent: 'TEMPARIO_TEMPO_SERVICO'` com `veiculo`, `ano`, `motor` e `servicos[]` extraídos, desde que `!isExplicitFinancialQuery(norm)` e não haja referência explícita a número de OS (`OS #1916`).
- **`agent_dispatcher.ts`:**
  - Na função `parseOSModuleIntent(text, activeOsId)` (linha 53), adiciona guarda no topo: se `isTemparioTechnicalQuery(norm)` for verdadeiro, retorna `null` imediatamente, impedindo que anos como `2020` sejam interpretados como `osId: '2020'`.
- **`manager_store_access.ts`:**
  - Na linha 147, inclui `'TEMPARIO_TEMPO_SERVICO'` no `allowedIntents`, delegando a execução ao `TemparioHybridCoordinator` com `effectiveLojaSlug = storeSlug`.

### 5.5. `src/hydra-sync/mcp_server.ts` & `src/hydra-sync/tool_execution_tracker.ts`
- Registra a tool `consultar_tempario_hibrido` em `ListToolsRequestSchema` e `CallToolRequestSchema`.
- Instrumenta cada invocação com `toolExecutionTracker.startTrace(turnId, 'consultar_tempario_hibrido', 'mcp', args)` e `endTrace()`.
- Em `public_response_guard.ts`, adiciona `consultar_tempario_hibrido` em `toolPatterns` (linha 459) e `tempario_vehicles|tempario_operations|tempario_suboperations|tempario_dependencies_edges|vec_tempario_chunks` em `schemaPatterns` (linha 442).

---

## 6. Formatação WhatsApp no Padrão Hermes (`balloon_composer.ts` + `public_response_guard.ts`)

Em conformidade estrita com `whatsapp_formatter.ts` (V2 - Gramática Nativa) e `public_response_guard.ts` (`purgeDecorativeEmojis`, `sanitizeWhatsAppMarkdown`, zero tabelas Markdown, zero `**`, zero `\u00A0`):

```text
*HYDRA | Tempário Técnico Automotivo*

> *Volkswagen Golf MK7.5 (2020) · Motor 1.4 16V TSI (EA211)*
- *Serviços consultados:* Substituição do Farol Dianteiro Esquerdo + Substituição do Radiador de Arrefecimento
- *Grau de dificuldade:* Médio

*Sequência de execução otimizada (Grafo de Acesso)*
- *1. Remover para-choque dianteiro (Desmontagem):* *0,40h* (24 min)
  Ferramentas: Chave Torx T25, Espátula de nylon
  Acesso compartilhado entre os 2 serviços (contabilizado 1 única vez)
- *2. Desconectar chicote elétrico principal (Desmontagem):* *0,10h* (6 min)
  Ferramentas: Extrator de conectores VAG
- *3. Drenar fluido e soltar mangueiras de arrefecimento (Desmontagem):* *0,45h* (27 min)
  Ferramentas: Alicate para abraçadeiras elásticas, Bandeja coletora
- *4. Remover suporte e substituir bloco óptico do farol esquerdo (Execução):* *0,40h* (24 min)
  Ferramentas: Chave Torx T30, Torquímetro (8 Nm)
- *5. Substituir colmeia do radiador principal (Execução):* *0,75h* (45 min)
  Ferramentas: Chave Torx T30
- *6. Reinstalar suporte e para-choque dianteiro (Remontagem):* *0,35h* (21 min)
  Acesso compartilhado entre os 2 serviços (contabilizado 1 única vez)
- *7. Abastecer aditivo G13, sangrar sistema e alinhar facho óptico (Teste e Ajuste):* *0,45h* (27 min)
  Ferramentas: Equipamento de vácuo de arrefecimento, Regloscópio

*Comparativo: Tempo Tabelado vs. Realidade de Pátio*
- *Tempo bruto somado (sem grafo):* 3,65h (219 min)
- *Economia por acesso compartilhado:* *-0,75h* (-45 min)
- *Tempo tabelado líquido (Manual OEM):* *2,90h* (2h 54 min)
- *Tempo médio de execução na rede (14 OSs encerradas):* *3,40h* (3h 24 min)
- *Permanência média em pátio (Lead Time):* *1,5 dias*
- *Gargalos documentados nas OSs:* Aguardo de entrega de radiador pelo fornecedor (registrado em 4 OSs).

> *Proveniência e Auditoria*
- *Classificação:* Manual Oficial OEM (Homologado)
- *Fonte:* Manual de Reparações VW ElsaPro / Elwin — Golf MK7 (Grupo 94, Seção 94-1 / Grupo 19, Seção 19-2)
- *Confiança da recuperação:* 96%
```
