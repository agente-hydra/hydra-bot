# Plano de Execução: Contas a Vencer Hoje x Entradas de Ontem no Balão 2

**Spec ID:** `hydra-daily-financial-cashflow-balance`  
**Data:** 09/10/2026  
**Status:** Planejamento Atualizado (SDD Proposal)  

---

## Tarefas de Implementação

- [x] [CRAWLER-DUE-TODAY] **Atualizar Crawler de Contas a Pagar para "Data de Vencimento" Hoje ($D$)**
  - Em `projects/hydra-rede/src/exportar_contas_pagar_cli.js` e `src/hydra-sync/contas_pagar_crawler.ts`:
  - Alterar o seletor `#ctl00_cph_rblFiltroData` para a opção `'2'` (**Data de Vencimento**).
  - Alterar as datas inicial e final para **Hoje** ($D$, dia atual da execução).
  - Testar na VPS e garantir que salva `Contas a Pagar - DD-MM-AAAA.pdf` e `.xlsx` com as contas a vencer hoje.
  - Ingerir no SQLite `contas_pagar_lancamentos` via `contas_pagar_bridge.js`.

- [x] [AGGREGATOR-DUE-TODAY] **Implementar Aggregator de Contas a Vencer no SQLite**
  - Em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Implementar `carregarContasAVencerHoje(dataHojeISO)` consultando lançamentos com `data_vencimento = ?`.
  - Normalizar e de-parar lojas pelo `matchStore`, excluindo `Master`.
  - Retornar mapa por loja e total geral a pagar da rede.

- [x] [KEEP-BALAO-1-CLEAN] **Garantir Balão 1 (`HYDRA | Operação`) Limpo e Focado**
  - Preservar estritamente o layout limpo de Pátio Ativo e os 6 carros críticos sem sinal de 60%.
  - Zero inclusão de tabelas de contas no Balão 1.

- [x] [BALAO-2-FINANCE-ENRICH] **Enriquecer Balão 2 (`HYDRA | Faturamento & CMV`) com Contas do Dia**
  - Em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js` (`formatarBalaoFaturamentoECmv`):
  - Cruzar cada loja com:
    - Entradas de ontem (vendidos ontem / o que cai hoje).
    - Contas a pagar hoje (contas a vencer no dia atual).
    - Saldo previsto hoje (`entrouOntem - aPagarHoje`) com status 🟢 `(Positivo)` ou 🔴 `(No vermelho)`.
  - Atualizar bloco `Consolidado da rede` com total de entradas, total a pagar hoje e saldo previsto da rede.
  - Adicionar destaques da diretoria (maior superávit de hoje e maior compromisso a pagar hoje).

- [x] [PIPELINE-INTEGRATION] **Integrar no Orquestrador `run_patio_daily.js`**
  - Passar `summaryData` e `contasAVencerSummary` para `formatarBalaoFaturamentoECmv` durante o despacho.
  - Sincronizar scripts atualizados para a VPS.

- [x] [VALIDATION-DISPATCH] **Validação na VPS e Disparo Exclusivo para `11996242812`**
  - Executar extração real das contas a vencer de hoje na VPS.
  - Disparar os 2 balões resultantes exclusivamente para o WhatsApp do desenvolvedor (`5511996242812`).
  - Validar visualização e batimento dos valores.
