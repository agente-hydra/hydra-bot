# Proposta de Correção: Recuperação dos Dados de Pátio Zerados & Blindagem de Frescor do Deep Crawler

**Spec ID:** `fix-patio-stale-crawler-and-zero-balance`  
**Data:** 22/10/2026  
**Status:** Planejamento (SDD Proposal)  

---

## 1. O Problema Real

No envio matinal de 22/10/2026, a planilha oficial `Carros em Patio - 22-10-2026.xlsx` e o relatório de `Conciliacao Patio x Rede - 22-10-2026.xlsx` apresentaram valores e recebimentos totalmente zerados ou gravemente divergentes:
1. **Em `Carros em Patio - 22-10-2026.xlsx`:**
   - 9 das 10 lojas ativas vieram com `Recebido Ontem: R$ 0,00` e `Saídas de Ontem: 0`.
   - Na aba `OS`, todas as ordens de serviço vieram com a coluna `PAGAMENTOS: "—"`.
2. **Em `Conciliacao Patio x Rede - 22-10-2026.xlsx`:**
   - Total Rede Bruto: **R$ 39.755,74** (18 transações em cartão/PIX).
   - Total Pátio: apenas **R$ 5.570,00** (índice de acurácia de apenas 14%).
   - **R$ 34.185,73** foram apontados erroneamente como *"Sobrando na Rede (Sem OS)"*.
   - 5 lojas inteiras constaram com Pátio R$ 0,00: **Kennedy** (R$ 13.617,63 na Rede x R$ 0 no Pátio), **Dom Pedro I** (R$ 6.234,90 na Rede x R$ 0 no Pátio), **Planalto** (R$ 2.038,30), **Piraporinha** (R$ 1.542,00) e **Jorge Beretta** (R$ 2.766,57).

---

## 2. Diagnóstico da Causa-Raiz (Evidências Fatuais)

Inspecionando os logs e o banco SQLite na VPS Linux (`operacional@100.126.50.101`):

1. **Defasagem Temporal Crítica de 25 Horas:**
   - A tabela `crawls_execucoes` e `ordens_servico` em `/home/operacional/hydra-data/hydra_ops.db` registraram o último crawl de `PATIO` em **21/10/2026 às 12:30:50Z (09:30 AM)**.
   - Os arquivos de cache granular `os_store_*.json` em `/home/operacional/hydra-data/crawls/` possuíam data/hora de modificação de **21/10 às 09:30 AM**.
   - Praticamente todos os pagamentos e baixas de OS ocorrem entre 10:00 e 18:30. Como os dados pararam às 09:30, nenhuma movimentação da tarde de 21/10 existia no banco.

2. **Falha Silenciosa de Módulo nos Crawlers Noturnos:**
   - O cron noturno (`run-nightly-prep.sh`) tentou acionar o Deep Crawler às 23:00, 01:00, 03:00, 05:00 e 07:00.
   - Em todas essas tentativas da madrugada, o processo abortou com:
     ```text
     Error: Cannot find module '/home/operacional/hydra/node_modules/tsx/dist/cli.mjs'
     ```
   - O diretório `/home/operacional/hydra/node_modules` estava ausente na VPS antes da correção do symlink e da implantação da release `4e607d5`.

3. **Colisão de Locks entre `hourly-finance` e `daily-full`:**
   - Às 08:15:00, o cron disparou o worker financeiro horário.
   - Quando a rotina de preparação tentou rodar o Deep Crawler às 08:19:42, o lock exclusivo `/tmp/hydra-data-refresh.lock` estava retido pelo worker financeiro, resultando em timeout de 300s.

4. **Bypass de Dados Obsoletos (Stale Data Bypass):**
   - Às 08:20:43, a rotina de Pátio foi executada forçadamente sobre os dados velhos de 25 horas. Sem pagamentos no registro, o multiconjunto gerou a planilha com valores zerados e a conciliação foi despachada para o financeiro e para o Davi com dados falsos.

---

## 3. Solução Proposta

### Fase A: Recuperação Factual Imediata dos Dados de 21/10 e 22/10
1. Executar extração completa do `deep-crawler.ts` (10 lojas credenciadas) agora que `tsx` e as dependências estão 100% íntegras na release ativa `4e607d5`.
2. O crawler raspará todas as OSs ativas e recentemente fechadas nas 10 lojas, navegando pelas 9 abas AJAX (incluindo `tapPagamento`) para extrair os pagamentos reais de 21/10.
3. Ingerir no SQLite `hydra_ops.db` e regenerar os 10 arquivos `os_store_*.json` frescos.
4. Reprocessar o Ledger Mensal de Pátio (`data/patio_ledger_2026-10.json`), limpando marcas incorretas do snapshot defeituoso de hoje cedo.
5. Reconstruir:
   - `Carros em Patio - 22-10-2026.xlsx` com as formas reais na coluna `PAGAMENTOS:`, valores em `Recebido Ontem` e `Saídas de Ontem`.
   - `Conciliacao Patio x Rede - 22-10-2026.xlsx` associando as 18 transações da Rede às OSs reais de Kennedy, Dom Pedro, Planalto, Piraporinha e Jorge Beretta.

### Fase B: Blindagem e Contenção Definitiva (Anti-Zero & Anti-Stale)
1. **Separação de Locks de Concorrência:**
   - Desacoplar o lock do `deep-crawler.ts` (`/tmp/hydra-deep-crawler.lock`) do lock do worker de metas horárias (`/tmp/hydra-hourly-finance.lock`), prevenindo timeouts cruzados.
2. **Hard Gate Anti-Stale no Despacho:**
   - O orquestrador matinal (`run_unified_morning_dispatch.js` e `run-unified-morning.sh`) deve validar o frescor dos stores (< 8h).
   - Se os stores estiverem defasados, o sistema **NUNCA** pode despachar planilhas zeradas para diretoria/financeiro: ele deve compulsoriamente acionar extração de emergência ou reter o despacho notificando o Dev.
3. **Validação de Não-Vacuidade na Conciliação:**
   - Se a Adquirente Rede tiver mais de R$ 10.000 em vendas e o Pátio registrar menos de 20% desse valor, classificar como anomalia de extração e barrar o despacho cego.

---

## 4. Contratos de Dados Afetados

- `ordens_servico` (SQLite WAL em `hydra_ops.db`)
- `os_store_<slug>.json` em `/home/operacional/hydra-data/crawls/`
- `data/patio_ledger_2026-10.json` (Monthly Ledger)
- `output/relatorios/Carros em Patio - 22-10-2026.xlsx`
- `output/relatorios/Conciliacao Patio x Rede - 22-10-2026.xlsx`

---

## 5. Risco Principal e Mitigação

- **Risco:** O ERP Oficina Inteligente bloquear sessões por concorrência de logins durante a extração das 10 lojas em horário comercial.
- **Mitigação:** O `deep-crawler.ts` executa de forma serial loja a loja com rotação de cookies e delay defensivo entre requisições WebForms, garantindo zero colisão de sessão.
