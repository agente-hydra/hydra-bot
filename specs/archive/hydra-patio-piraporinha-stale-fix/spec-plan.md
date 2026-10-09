# Plano de Execução: Blindagem do Crawler & Reconciliação Piraporinha

**Spec ID:** `hydra-patio-piraporinha-stale-fix`  
**Status:** CONCLUÍDO — AGUARDANDO ARQUIVAMENTO (`/vibe-archive hydra-patio-piraporinha-stale-fix`)

---

## Tasks

### Fase 1: Active Recovery em `ensureCompany` (`core.ts`)
- [x] [CRAWLER] Implementar detecção de deslogamento (`Default.aspx` / redirect) em `src/workers/oficina-agent/playwright/actions/core.ts` com re-autenticação automática.
- [x] [CRAWLER] Implementar recarga ativa (`page.reload({ waitUntil: 'load' })`) entre tentativas com timeout ampliado para 12s no header `#lblSiglaEmpresa`.
- [x] [TEST] Adicionar teste unitário de resiliência validando recuperação de troca de empresa após falha temporária simulada.

### Fase 2: Fila de Auto-Healing no `deep-crawler.ts`
- [x] [CRAWLER] Adicionar fila `lojasComFalhaOS: string[]` no loop de 10 lojas de `src/hydra-sync/deep-crawler.ts`.
- [x] [CRAWLER] Implementar segunda passada de recuperação (Recovery Pass) após a etapa de CMV para re-executar extração cirúrgica de OS nas lojas que falharam na 1ª passada.
- [x] [CRAWLER] Garantir que o processo sinalize erro caso o ciclo termine com lojas pendentes mesmo após a retentativa.

### Fase 3: Freshness Guard no `patio_hydra_bot_adapter.js`
- [x] [ADAPTER] Implementar `validateStoresFreshness` em `projects/hydra-rede/src/patio_hydra_bot_adapter.js` checando se o mtime e `ultima_atualizacao` de cada loja pertencem à madrugada da execução.
- [x] [ADAPTER] Bloquear geração de relatórios com dados de lojas obsoletos (>12h) sem aviso explícito e acionar alerta de contingência dev.

### Fase 4: Reconciliação dos Dados Reais de Piraporinha (09/10/2026)
- [x] [DATA] Ingerir a extração atualizada de `MPpiraporinha` na VPS (`os_store_MPpiraporinha.json` e `hydra_ops.db`).
- [x] [RECON] Regenerar `Carros em Patio - 09-10-2026.xlsx` via `run_patio_daily.js --immediate`.
- [x] [AUDIT] Comparar o arquivo regenerado contra `CONCILIAÇÃO 0910.xlsx` para comprovar que as 8 OSs de Piraporinha, pagamentos de ontem e saldo pendente (R$ 4.778,70) estão 100% conciliados e idênticos.

### Fase 5: Validação Final & Deploy
- [x] [GATE] Rodar `npm run typecheck:hydra` e validação TypeScript/Node nos módulos atualizados garantindo 0 erros.
- [x] [DEPLOY] Sincronizar os módulos atualizados (`core.ts`, `deep-crawler.ts`, `patio_hydra_bot_adapter.js`) para a VPS (prontos para git commit/push no `/vibe-archive`).
