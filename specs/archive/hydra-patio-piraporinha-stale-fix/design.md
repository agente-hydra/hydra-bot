# Design Técnico: Blindagem de Resiliência do Crawler & Validação de Frescor de Pátio

**Spec ID:** `hydra-patio-piraporinha-stale-fix`  
**Data:** 09/10/2026  
**Status:** PROPOSTA DE ARQUITETURA

---

## 1. Fluxo de Execução com Auto-Healing & Validação de Frescor

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Cron VPS (03:15 AM)
    participant Crawler as deep-crawler.ts
    participant Core as core.ts (ensureCompany)
    participant ERP as Oficina Inteligente
    participant SQLite as hydra_ops.db
    participant Adapter as patio_hydra_bot_adapter.js
    participant Patio as patio_ledger_engine.js

    Cron->>Crawler: Inicia ciclo diário matinal
    Crawler->>Core: ensureCompany(slug)
    Core->>ERP: Troca empresa e valida header
    alt Timeout ou header vazio
        Core->>ERP: Active Recovery (Recarrega página / revalida login)
        Core->>ERP: 2ª tentativa de troca
    end
    alt Se ainda falhar
        Core-->>Crawler: Lança erro
        Crawler->>Crawler: Registra na fila de retentativa (lojasComFalhaOS)
    end
    Note over Crawler: Conclui 10 lojas normais
    alt Existem lojas pendentes na fila
        Crawler->>Crawler: Executa Recovery Pass nas lojas pendentes
        Crawler->>ERP: Re-executa extração cirúrgica de OS
        Crawler->>SQLite: Persiste dados frescos e atualiza snapshot
    end

    Note over Cron: 08:00 AM - Disparo de Pátio
    Cron->>Adapter: loadHydraBotStoresData()
    Adapter->>Adapter: validateStoreFreshness(targetDate)
    alt Loja com mtime < startOfDay (Stale)
        Adapter->>Crawler: Trigger extração cirúrgica de emergência
        Adapter->>SQLite: Carrega dados atualizados
    end
    Adapter->>Patio: Retorna dados certificados
    Patio->>Patio: Constrói planilha e resumo com 10/10 lojas frescas
```

---

## 2. Contratos & Interfaces TypeScript

### 2.1 Interface de Validação de Frescor (`store_freshness_contract.ts`)

```typescript
export interface StoreFreshnessCheck {
  storeSlug: string;
  filePath: string;
  lastModifiedMs: number;
  lastModifiedISO: string;
  isFresh: boolean;
  ageHours: number;
  reason?: 'file_missing' | 'stale_date' | 'empty_file' | 'fresh';
}

export interface NetworkFreshnessReport {
  executionDateBR: string;
  totalStores: number;
  freshStores: number;
  staleStores: string[];
  missingStores: string[];
  allCertified: boolean;
  checks: Record<string, StoreFreshnessCheck>;
}
```

### 2.2 Assinatura e Comportamento do Active Recovery em `core.ts`

```typescript
export interface EnsureCompanyOptions {
  maxAttempts?: number;
  headerTimeoutMs?: number;
  forceReloadOnRetry?: boolean;
}

/**
 * Garante a seleção da empresa com recuperação ativa contra travamentos ASP.NET
 */
export async function ensureCompany(
  page: Page,
  slugEmpresa: string,
  options?: EnsureCompanyOptions
): Promise<void>;
```

---

## 3. Módulos a Modificar

1. **`src/workers/oficina-agent/playwright/actions/core.ts`**:
   - Refatorar `ensureCompany`:
     - Implementar checagem de URL antes de ler `#lblSiglaEmpresa`.
     - Em caso de falha na tentativa $N$, verificar se a página foi deslogada; se sim, re-autenticar.
     - Se ainda estiver na aplicação, executar `page.reload({ waitUntil: 'load' })` para resetar o pipeline ASP.NET.

2. **`src/hydra-sync/deep-crawler.ts`**:
   - Implementar `recoveryQueue: string[]` para armazenar lojas com Circuit Breaker ativado.
   - Antes da consolidação final e geração do PDF de Metas, executar segunda passada cirúrgica para lojas da fila.
   - Retornar código de saída diferente de 0 caso alguma loja permaneça pendente após a recuperação, impedindo que tarefas encadeadas assumam sucesso cego.

3. **`projects/hydra-rede/src/patio_hydra_bot_adapter.js`**:
   - Implementar `validateStoresFreshness(sourceDir, referenceDateBR)`.
   - Se um arquivo de loja tiver mais de 12 horas ou data anterior a D-1/D, disparar erro determinístico e tentar recarga se local/VPS.

4. **Sincronização Operacional VPS**:
   - Executar extração atualizada para Piraporinha.
   - Regenerar a planilha do dia 09/10 com os dados oficiais batendo com `CONCILIAÇÃO 0910.xlsx`.
