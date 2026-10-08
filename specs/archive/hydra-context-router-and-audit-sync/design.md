# Design de Implementação — hydra-context-router-and-audit-sync

## 1. Arquitetura e Fluxo de Dados

```
+-----------------------------------------------------------------------------------+
|                           MENSAGEM DE ENTRADA (WHATSAPP)                          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
               +---------------------------------------------------+
               |  Filtro de Precedência Financeira / Métricas     |
               |  (faturamento, meta, cmv, vendas, ticket, etc.)   |
               +---------------------------------------------------+
                                   /               \
                       SIM (Financeiro)          NÃO (Operacional/Veículo)
                                 /                   \
                                v                     v
+--------------------------------------------+  +-----------------------------------+
| Pula Seção 2.5 (Zero sequestro de veículo) |  | Checa Seção 2.5:                  |
| Segue para LLM com contexto financeiro ou  |  | - Se `PENDING_CHOICE`: resolve.   |
| Router de Faturamento de Loja / Rede       |  | - Se `DELIVERED`: não sequestra.  |
+--------------------------------------------+  | - Se anáfora "da os": herda osId. |
                                                +-----------------------------------+
                                                              |
                                                              v
                                                +-----------------------------------+
                                                | Timeout Guard (60s)               |
                                                | Fallback herda osId em contexto   |
                                                | (Zero vazamento cross-store)      |
                                                +-----------------------------------+
```

---

## 2. Modificações em Módulos

### 2.1 `src/hydra-sync/agent_dispatcher.ts`
1. **Filtro de Precedência Financeira:**
   Criar helper defensivo:
   ```typescript
   export function isExplicitFinancialQuery(text: string): boolean {
     const norm = normalizarTexto(text);
     return /\b(faturament|faturou|venda|vendas|meta|metas|cmv|ranking|ticket|ticket medio|area|areas|setor|setores)\b/i.test(norm);
   }
   ```
   Na Seção 2.5 (linha ~750):
   ```typescript
   const isFinancial = isExplicitFinancialQuery(textoLimpo);
   // Se for consulta financeira, NUNCA tratar como consulta de veículo
   if (isFinancial) {
     // Prossegue para Intent Rewriter / LLM sem cair no resolvedor de veículos
   }
   ```
2. **Correção de `pendingRequest`:**
   Substituir a checagem:
   ```typescript
   // ANTES (problemático):
   (prevPending && (currentStoreSlug || norm.includes('linea') || norm.includes('por favor') || norm.includes('quero saber')))

   // DEPOIS (blindado):
   (!isFinancial && prevPending?.deliveryStatus === 'PENDING_CHOICE' && (currentStoreSlug || norm.includes('por favor') || norm.includes('quero saber')))
   ```
3. **Resolução de Anáfora de OS do Bot:**
   Se o usuário disser *"me de detalhes da os"*, *"detalhes da os por favor"* sem especificar número, e o turno anterior do bot continha um número de OS (`lastResponseText.match(/\b(?:os|ordem)\s*#?\s*(\d{1,6})\b/i)`), herdar esse `osId` para o contexto atual e chamar `getOSDetails(db, { os_id, loja_slug })`.

4. **Isolamento de Loja no Fallback de Timeout:**
   No bloco `catch` do motor LLM (`agent_dispatcher.ts` linha ~1430):
   Se a consulta for de OS e não tiver loja explícita, ancorar compulsoriamente na loja ativa ou em contexto, proibindo chamada irrestrita a `retrieveOperationalData` sem parâmetros.

---

### 2.2 `src/hydra-sync/hourly_finance_worker.ts` & `relatorio_operacao_crawler.ts`
1. **Correção da Validação de CMV:**
   Em `src/hydra-sync/relatorio_operacao_crawler.ts`:
   ```typescript
   export function validarIntegridadeRelatorioOperacao(
     extracao: ExtracaoRelatorioLoja | null,
     snapshotAnteriorExiste = false
   ): void {
     if (!extracao || !extracao.cmv) {
       throw new Error(`Falha na extração: linha totalizadora de CMV não localizada`);
     }
     // Permite 0 no início de mês quando custos ainda não foram lançados
     if (!Number.isFinite(extracao.cmv.cmv_percentual) || extracao.cmv.cmv_percentual < 0) {
       throw new Error(`cmv_percentual inválido (${extracao.cmv.cmv_percentual}) para ${extracao.lojaSlug}: deve ser número finito >= 0`);
     }
     if (!Number.isFinite(extracao.cmv.faturamento_total) || extracao.cmv.faturamento_total < 0) {
       throw new Error(`faturamento_total inválido (${extracao.cmv.faturamento_total}) para ${extracao.lojaSlug}: deve ser número finito >= 0`);
     }
   }
   ```
2. **Ingestão Horária de CMV:**
   Em `src/hydra-sync/hourly_finance_worker.ts`:
   Dentro do loop de lojas, logo após o download de `Vendas do Dia`, invocar:
   ```typescript
   await page.locator('#ctl00_cph_btnGestaoPeriodica').click();
   await page.locator('#ctl00_cph_grdFaturamentoPorArea tr').nth(1).waitFor({ state: 'visible', timeout: 15000 });
   const extracaoCMV = await extrairTabelasRelatorioOperacao(page, slug);
   if (extracaoCMV) {
     salvarRelatorioOperacao(db, {
       lojaSlug: slug,
       dataInicio: extracaoCMV.dataInicio,
       dataFim: extracaoCMV.dataFim,
       cmv: extracaoCMV.cmv,
       areas: extracaoCMV.areas,
       midia: extracaoCMV.midia
     });
   }
   ```
3. **Correção de Imports em `deep-crawler.ts`:**
   Remover o import do inexistente `extrairDetalhe` de `os_deep_inspector.js` ou importar de `os_deep_inspector.ts`.

---

### 2.3 `src/hydra-sync/hydra_auditor_service.ts`
1. **Slotting de Briefing Executivo:**
   Calcular o slot atual no início do serviço:
   ```typescript
   const currentHour = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit' });
   const slot = parseInt(currentHour, 10) < 12 ? 'matutino' : 'vespertino';
   const tipoRelatorioComSlot = isCompact ? `briefing_compacto_${slot}` : `briefing_executivo_${slot}`;
   ```
2. **Checagem de Idempotência com Slot:**
   Usar `tipoRelatorioComSlot` na verificação de `isBriefingAlreadyDispatched`:
   ```typescript
   if (db && isBriefingAlreadyDispatched(db, dataReferencia, cleanP, tipoRelatorioComSlot)) {
     puladoPorIdempotencia = true;
     console.log(`[Hydra Service] ⏭️ IDEMPOTÊNCIA: ${cleanP} já recebeu o relatório ${tipoRelatorioComSlot} referente a ${dataReferencia}. Envio suprimido.`);
   }
   ```
   Isso permite que o disparo das 06:00/09:00 registre `briefing_executivo_matutino` e o das 14:00 registre `briefing_executivo_vespertino`, ambos sendo entregues sem interferência mútua.
