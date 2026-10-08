# Design Técnico — Correção da Contagem de OS em Aberto

**Spec:** `hydra-confirmed-open-os`  
**Data:** 06/10/2026  
**Repositório:** `hydra-bot`  
**Status:** ESPECIFICAÇÃO DE DESIGN FORMALIZADA  

---

## 1. Fluxo de Dados e Arquitetura

O diagrama abaixo ilustra a segregação entre o fluxo de coleta/auditoria nominal e a camada de consulta analítica/conversacional:

```mermaid
flowchart TD
    subgraph Crawler ["Coleta Deep Crawler"]
        A[deep-crawler.ts] -->|import { extrairDetalhe }| B[os_deep_inspector.ts]
        B -->|Abre Popup e Extrai Dados| C[Detalhe da OS]
        C -->|Sucesso Nominal| D[formalizarTransicaoNominalOS]
        C -->|Inconclusivo / Erro| E[Mantém TRANSICAO_PENDENTE]
    end

    subgraph Database ["Base de Dados SQLite (ordens_servico)"]
        F[(ordens_servico)]
        F ---|is_aberta = 1 & estado != TRANSICAO_PENDENTE| G[Confirmadas Abertas]
        F ---|estado = TRANSICAO_PENDENTE| H[Transições Pendentes]
    end

    subgraph DataLayer ["Camada de Dados (db_repository.ts / .js)"]
        I[getOpenOSCounts] -->|Filtro Disjunto| F
        J[getPatioOverview] -->|total_abertas = confirmed_open| I
        K[getStoreDrilldown] -->|total_veiculos_patio = confirmed_open| I
        L[getChecklistAudit] -->|Exclui TRANSICAO_PENDENTE| F
        M[computeHydraHealthMetrics] -->|totalOSsAbertas = confirmed_open| I
    end

    subgraph Telemetry ["Auditoria & Logs"]
        I -->|JSON via stderr| N[hydra_open_os_counts]
    end

    D --> Database
    E --> Database
```

---

## 2. Contratos e Tipos TypeScript

### 2.1 Interface Central de Contagem
Adicionada em `src/hydra-sync/db_repository.ts` e refletida em `src/hydra-sync/db_repository.js`:

```ts
export interface OpenOSCounts {
  /** Ordens elegíveis por flag (is_aberta = 1) com estado != 'TRANSICAO_PENDENTE' */
  confirmed_open: number;
  /** Ordens com estado = 'TRANSICAO_PENDENTE' (em conferência pós-fechamento) */
  transition_pending: number;
  /** União disjunta total para conciliação e auditoria (confirmed_open + transition_pending) */
  total_open_like: number;
}
```

### 2.2 Atualização de `StoreDrilldownResult`
Em `src/hydra-sync/db_repository.ts`:

```ts
export interface StoreDrilldownResult {
  loja_slug: string;
  /** Mantido por compatibilidade: reflete confirmed_open */
  total_veiculos_patio: number;
  confirmed_open: number;
  transition_pending: number;
  total_open_like: number;
  saldo_total_receber: number;
  faturamento_mes: number;
  volume_os_mes: number;
  ticket_medio: number;
  carros_travados_5d: number;
  sem_checklist_mecanico: number;
  sem_checklist_entrada: number;
  alertas_sem_sinal: number;
  data_referencia_metas?: string;
  posicao_hora_metas?: string;
  is_metas_stale?: boolean;
}
```

---

## 3. Implementação das Consultas SQL e Funções

### 3.1 Função Atômica `getOpenOSCounts`
Executa em consulta única snapshot com agregação condicional:

```ts
export function getOpenOSCounts(
  db: Database.Database,
  lojaSlug?: string
): OpenOSCounts {
  try {
    const query = lojaSlug
      ? `
        SELECT
          COUNT(CASE WHEN is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE' THEN 1 END) AS confirmed_open,
          COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending
        FROM ordens_servico
        WHERE LOWER(loja_slug) = LOWER(?)
      `
      : `
        SELECT
          COUNT(CASE WHEN is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE' THEN 1 END) AS confirmed_open,
          COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending
        FROM ordens_servico
      `;

    const row = (lojaSlug ? db.prepare(query).get(lojaSlug.trim()) : db.prepare(query).get()) as {
      confirmed_open: number;
      transition_pending: number;
    } | undefined;

    const confirmed = row?.confirmed_open ?? 0;
    const pending = row?.transition_pending ?? 0;
    const total = confirmed + pending;

    const result: OpenOSCounts = {
      confirmed_open: confirmed,
      transition_pending: pending,
      total_open_like: total
    };

    // Log estruturado em stderr para isolar de stdout (MCP seguro)
    console.error(JSON.stringify({
      event: 'hydra_open_os_counts',
      loja: lojaSlug ? lojaSlug.trim() : 'REDE',
      confirmed_open: confirmed,
      transition_pending: pending,
      total_open_like: total
    }));

    return result;
  } catch (err: any) {
    console.error(`[DB] Erro ao consultar contagem de OS em aberto (loja: ${lojaSlug || 'REDE'}):`, err?.message || err);
    throw err;
  }
}
```

### 3.2 Modificação em `getPatioOverview`
Preserva os somatórios financeiros de `total_valor` e `total_restante` enquanto recalcula a contagem de confirmadas e adiciona as colunas de auditoria:

```sql
SELECT 
  loja_slug,
  COUNT(CASE WHEN is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE' THEN 1 END) AS total_abertas,
  COUNT(CASE WHEN is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE' THEN 1 END) AS confirmed_open,
  COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending,
  (
    COUNT(CASE WHEN is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE' THEN 1 END) +
    COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END)
  ) AS total_open_like,
  SUM(total_os) AS total_valor,
  SUM(valor_restante) AS total_restante
FROM ordens_servico
WHERE is_aberta = 1 OR UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE'
GROUP BY loja_slug
ORDER BY total_abertas DESC
```

### 3.3 Modificação em `getStoreDrilldown`
Separa a contagem condicional preservando o somatório de `total_restante`:

```ts
const patioRow = db.prepare(`
  SELECT 
    COUNT(CASE WHEN is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE' THEN 1 END) AS total_abertas,
    COUNT(CASE WHEN is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE' THEN 1 END) AS confirmed_open,
    COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending,
    SUM(valor_restante) as total_restante
  FROM ordens_servico
  WHERE (is_aberta = 1 OR UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE') 
    AND LOWER(loja_slug) = LOWER(?)
`).get(slug) as any;

const confirmedOpen = patioRow?.confirmed_open ?? 0;
const transitionPending = patioRow?.transition_pending ?? 0;

// total_veiculos_patio passa a expressar confirmedOpen
```

### 3.4 Modificação em `getChecklistAudit`
Para manter a coerência da amostragem com a contagem confirmada, a auditoria de checklists filtra ordens em aberto excluindo transições pendentes:

```sql
SELECT os_id, loja_slug, veiculo, placa, dias_no_patio, raw_payload
FROM ordens_servico
WHERE is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
```

### 3.5 Modificação em `computeHydraHealthMetrics`
Substitui a consulta direta por `getOpenOSCounts`:

```ts
const openCounts = getOpenOSCounts(db);
indiceVetorial.totalOSsAbertas = openCounts.confirmed_open;
```

---

## 4. Correção do Vínculo de Import/Export no Crawler

### 4.1 `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts`
Localizar a declaração de `extrairDetalhe` (linha ~367) e adicionar o prefixo `export`:

```ts
// ANTES (em produção):
async function extrairDetalhe(page: Page, osId: string, baseUrl: string): Promise<Partial<DocumentoAberto>> {

// DEPOIS:
export async function extrairDetalhe(page: Page, osId: string, baseUrl: string): Promise<Partial<DocumentoAberto>> {
```

### 4.2 `src/hydra-sync/deep-crawler.ts`
Manter o import estático existente e o tratamento de erro por loja:
```ts
import { handleOSDeepInspector, extrairDetalhe } from '../workers/oficina-agent/playwright/actions/os_deep_inspector.js';
```
Garantir que falhas retornadas em `detalhe.erro` não promovam a OS nem encerrem a quarentena prematuramente.

---

## 5. Divisão de Responsabilidade entre Agentes

| Atribuição | Agente Responsável | Módulos |
|---|---|---|
| **Coordenação & Relatório** | Principal (AGY CLI) | Coordena execução sequencial, consolida diffs e fornece roteiro de WhatsApp ao usuário. |
| **Correção do Crawler** | Executor 1 | `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts`<br>`src/hydra-sync/deep-crawler.ts` |
| **Camada de Dados & Auditoria** | Executor 2 | `src/hydra-sync/db_repository.ts`<br>`src/hydra-sync/db_repository.js` |
