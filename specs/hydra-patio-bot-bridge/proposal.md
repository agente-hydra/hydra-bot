# Proposta: Reutilização de Dados do Hydra Bot para Conciliação de Pátio & OS sem Scraper Redundante

**Spec ID:** `hydra-patio-bot-bridge`  
**Data:** 07/10/2026  
**Status:** PROPOSTA / EM REVISÃO

---

## 1. Contexto e Evidência Real do Problema

### O que ocorreu no run de 07/10/2026:
1. **Conflito de Sessão e Timeout no Login:**
   - O crawler dedicado de pátio (`crawler_patio_oi.js`) abria uma instância separada do Chromium Playwright às 07:30 AM para logar no portal Oficina Inteligente com a credencial `mvinyciusp@gmail.com`.
   - O Oficina Inteligente opera sob arquitetura ASP.NET WebForms legada, que mantém uma sessão única ativa por usuário via cookie `ASP.NET_SessionId`.
   - Logins concorrentes ou redundantes invalidam a sessão ativa, causando timeouts na tela de login e dependência de fallbacks locais.
2. **Exportação Frágil de XLS:**
   - O processo anterior navegava loja a loja em `wfRelatorioConferenciaOSxFinanceiro.aspx` tentando clicar no botão de exportar para baixar 10 planilhas `.xls`.
   - Cada download leva tempo, está sujeito a falhas de rede, Cloudflare Turnstile e frequentemente gera datas como números seriais inteiros do Excel (ex: `46274`, `46273`).
3. **Redundância Operacional:**
   - O robô principal do Hydra (`hydra-bot`), através de `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts` e `deep-crawler.ts`, **já realiza a varredura cirúrgica de todas as OSs abertas da rede**.
   - O robô entra em cada OS individualmente, extrai 9 abas de detalhe do DOM (cabeçalho, itens de produtos e serviços, parcelas de pagamento, saldo restante, checklists, adiantamentos e histórico) e persiste esses dados em arquivos estruturados (`os_store_<slug>.json`) e no banco SQLite (`hydra_ops.db`).

---

## 2. Solução Proposta

### Ação 1: Criação do Adaptador de Dados (`patio_hydra_bot_adapter.js`)
Em vez de disparar um navegador para baixar arquivos `.xls`, criar o módulo `projects/hydra-rede/src/patio_hydra_bot_adapter.js` que:
1. Consome os dados brutos de OS já extraídos pelo robô (lendo os arquivos `os_store_<slug>.json` ou SQLite `ordens_servico`).
2. Implementa sincronização transparente: se executado na máquina local, busca os snapshots mais recentes da VPS via SSH/SCP ou consome a réplica local persistida.
3. Rastreia o timestamp exato da extração (`data_extracao` / `ultima_atualizacao`) para informar com precisão o momento em que os dados foram capturados no ERP.

### Ação 2: Filtros de Negócio para o Relatório de Pátio
Aplicar as regras operacionais da oficina:
- **Catálogo de 10 Lojas Operacionais:**
  - `MPplanalto` $\rightarrow$ `brasicar_planalto` (Planalto)
  - `MPpiraporinha` $\rightarrow$ `emporio_piraporinha` (Piraporinha)
  - `ReiDoOleoMaua` $\rightarrow$ `mhe_maua` (Mauá)
  - `MPkennedy` $\rightarrow$ `mp_kennedy` (Kennedy)
  - `MPrudge` $\rightarrow$ `cap_rudge_ramos` (Rudge Ramos)
  - `MPSantoAndre` $\rightarrow$ `hd_santo_andre` (Santo André)
  - `ReiDoModulo` $\rightarrow$ `mp_rei_modulo` (Rei do Módulo)
  - `MPJorgeBeretta` $\rightarrow$ `dhjv_jorge_beretta` (Jorge Beretta)
  - `MPdompedro1` $\rightarrow$ `dp_dom_pedro` (Dom Pedro I)
  - `MPJabaquara` $\rightarrow$ `jab_jabaquara` (Jabaquara)
  - **Exclusão Estrita:** `MPMaster` (matriz administrativa sem pátio).
- **Filtro de Documento:** Apenas `tipo === 'OS'` (ignora `OR` / orçamentos).
- **Tratamento de Data:** Usa `data_inicio` da OS convertido para o formato canônico `DD/MM/YYYY` sob a coluna `Data Entrada:`.
- **Valores e Pagamentos:**
  - `Valor:` reflete `valor_restante` (saldo devedor). Se `0`, preserva no relatório conforme máquina de estados do mês.
  - `PAGAMENTOS:` monta descrição clara a partir do array `pagamentos` (ex: `Crédito: R$ 604,50; PIX: R$ 500,00`), evitando texto vazio.

### Ação 3: Desacoplamento e Aceleração do `run_patio_daily.js`
- Substituir a chamada pesada do Playwright em `run_patio_daily.js` pela ingestão via adaptador.
- Tempo de processamento: reduzido de **~5 minutos para < 1 segundo**.
- Zero risco de derrubar sessões ativas do Oficina Inteligente.

### Ação 4: Formatação da Mensagem WhatsApp e Envio
- Gerar a planilha `CONCILIACAO_PATIO_DDMM.xlsx` com o design Slate corporativo idêntico ao modelo.
- Disparar mensagem WhatsApp para o usuário e para o financeiro contendo:
  - Cabeçalho oficial com identificação da extração.
  - Timestamp transparente: "Atualizado com dados de DD/MM/AAAA às HH:mm extraídos via Hydra Bot".
  - Disclaimer explícito: "Relatório preliminar de pátio extraído via Hydra Bot para conferência e validação".

---

## 3. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Snapshot de OS desatualizado na VPS por lock travado | Médio | Validador de frescor de dados com fallback para última extração auditada e exibição explícita do timestamp |
| Diferença de nomenclatura entre slugs do bot e do ledger | Baixo | Tabela de equivalência estrita 1:1 no adaptador |
| Envio duplicado para o financeiro | Alto | Flag de controle `--target=dev` / `--target=client` com confirmação |
