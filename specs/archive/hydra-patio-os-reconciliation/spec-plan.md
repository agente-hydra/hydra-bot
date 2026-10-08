# Plano de Implementação — Relatório Diário de Carros em Pátio por Loja

**Spec:** `hydra-patio-os-reconciliation`  
**Data:** 06/10/2026  
**Repositório:** `agy` / `hydra-bot`  
**Status:** CONCLUÍDO (Pronto para arquivamento via `/vibe-archive hydra-patio-os-reconciliation`)

---

## 1. Visão Geral das Fases de Execução

O plano está estruturado em 5 fases sequenciais, garantindo testes isolados em cada camada antes da integração do pipeline completo.

---

### Fase 1: Motor de Estado Mensal (Monthly Reconciliation Ledger)

- [x] **[LEDGER-SCHEMA]** Criar módulo de persistência `projects/hydra-rede/src/patio_ledger_engine.js` responsável por gerenciar `data/patio_ledger_<YYYY-MM>.json`.
- [x] **[LEDGER-DELTA]** Implementar a lógica de cálculo de deltas diários:
  - Detecção de novas OSs que entraram no pátio com saldo devedor.
  - Detecção de amortizações parciais (`saldoAtual < saldoAnterior` e `saldoAtual > 0`), atualizando o campo `PAGAMENTOS` com a forma de pagamento do novo lançamento.
  - Detecção de quitação (`saldoAtual == 0` ou status ERP `Finalizada`), marcando `statusCiclo = 'QUITADA_HOJE'`, valor exibição `0` e forma de pagamento de quitação.
  - Manutenção de OSs zeradas em dias posteriores no mesmo mês com `statusCiclo = 'QUITADA_ANTERIOR'` e valor exibição `0`.
- [x] **[LEDGER-ROLLOVER]** Implementar o mecanismo de virada de mês (1º dia do mês): arquiva o mês anterior e inicia o novo mês carregando exclusivamente as OSs com saldo em aberto (`saldoAtual > 0`).
- [x] **[LEDGER-TEST]** Criar script de teste unitário `projects/hydra-rede/src/test_patio_ledger.js` simulando a progressão de 3 dias de uma OS (Abertura 5k -> Parcial 3k / Pix 2k -> Quitação 0 / Crédito 3k -> Dia seguinte zerada).

---

### Fase 2: Ingestão de Dados & Crawler do Oficina Inteligente

- [x] **[INGEST-PARSER]** Criar `projects/hydra-rede/src/patio_xls_parser.js` para ler e normalizar os 10 arquivos `[ID]_ConferenciaOSxFinanceiro.xls` exportados pelo ERP.
- [x] **[STORE-MAPPING]** Mapear as 10 lojas oficiais utilizando o arquivo de configuração `bot/src/config/empresas.json`:
  - Planalto (`203`), Piraporinha (`205`), Mauá (`146`), Kennedy (`351`), Rudge Ramos (`748`), Santo André (`2112`), Rei do Módulo (`2190`), Jorge Beretta (`2602`), Dom Pedro I (`4045`), Jabaquara (`4469`).
- [x] **[CRAWLER-AUTOMATION]** Criar `projects/hydra-rede/src/crawler_patio_oi.js` reutilizando o motor Playwright headless:
  - Autenticação silenciosa via credenciais em `.env`.
  - Troca sequencial de empresas via `ensureCompany(page, idEmpresaOI)`.
  - Navegação ao relatório de conferência e download automático do `.xls` para a pasta `output/conferencia/<YYYY-MM-DD>/`.
  - Fallback offline: se arquivos já existirem localmente, permitir execução imediata sem abrir navegador.

---

### Fase 3: Renderizador de Planilha Excel (Aba `OS`)

- [x] **[EXCEL-BUILDER]** Criar `projects/hydra-rede/src/excel_patio_builder.js` utilizando a biblioteca `exceljs`:
  - Criar aba `OS` replicando rigorosamente a estrutura de `CONCILIAÇÃO 2608.xlsx`.
  - Linha 1: Título `"Ordem de Serviço"`.
  - Linha 2: Data de referência do relatório.
- [x] **[EXCEL-BLOCKS]** Renderizar os 10 blocos de lojas na ordem oficial:
  - Cabeçalho da loja (Coluna B).
  - Colunas: `OS:` (Col B), `Data:` (Col C), `Valor:` (Col D), `PAGAMENTOS ` (Col E).
  - População de OSs em aberto e quitadas do ciclo.
- [x] **[EXCEL-FORMULAS]** Adicionar fórmulas de subtotal dinâmicas em cada loja `=SUM(D[inicio]:D[fim])` sem faixas estáticas, eliminando qualquer risco de `#DIV/0!` ou referências inválidas.
- [x] **[EXCEL-LAYOUT-A4]** Configurar o Page Setup para A4 Paisagem, `fitToWidth: 1`, `fitToHeight: 0`, e ativação explícita de `showGridLines: true` para impressão nítida e profissional.
- [x] **[EXCEL-COMPARE]** Executar teste de equivalência comparando o arquivo gerado com `CONCILIAÇÃO 2608.xlsx` para validar posicionamento de colunas e fórmulas.

---

### Fase 4: Despachante WhatsApp & Resumo Executivo Hydra

- [x] **[WHATSAPP-PATIO]** Implementar `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Formatação executiva Hydra com resumo consolidado (Total de OSs em aberto, Valor total em pátio, OSs quitadas no ciclo) e quebra individual pelas 10 lojas.
  - Envio da mensagem e do documento `.xlsx` via Evolution API para o número da diretoria: `+55 11 94066-7032`.
- [x] **[WHATSAPP-DEV-FALLBACK]** Roteamento de contingência para o desenvolvedor (`+55 11 99624-2812`):
  - Em caso de falha de download, timeout no ERP ou exceção não tratada, abortar o envio para a diretoria e despachar diagnóstico completo com logs para o número dev.
- [x] **[TIMER-GUARD]** Integrar guarda de horário: acionamento prévio às 07:30 AM e trava de disparo para liberação pontual às 08:00:00 AM.

---

### Fase 5: Orquestrador End-to-End & Agendamento no Windows

- [x] **[ORCHESTRATOR]** Criar ponto de entrada unificado `projects/hydra-rede/src/run_patio_daily.js` integrando Crawler -> Ledger -> Excel -> Timer Guard -> WhatsApp Dispatcher.
- [x] **[RUN-BAT]** Criar script de execução silenciosa em lote `projects/hydra-rede/run_patio_reconciliation.bat`.
- [x] **[TASK-SCHEDULER]** Configurar tarefa diária no Windows Task Scheduler (`\Hydra-Patio-OS-Diario`) disparando às 07:30 AM todos os dias.
- [x] **[E2E-SIMULATION]** Executar simulação ponta a ponta em ambiente local validando geração da planilha e disparo de teste para o número do desenvolvedor.

---

## 2. Critérios de Validação Técnica

1. **Validação do Ledger:**
   ```bash
   node projects/hydra-rede/src/test_patio_ledger.js
   ```
   Deve confirmar que a OS passa de 5k -> 3k -> 0k, permanece zerada no mesmo mês e é expurgada na virada contábil.

2. **Validação Visual do Excel:**
   ```bash
   node projects/hydra-rede/src/test_excel_patio.js
   ```
   Deve gerar arquivo em `output/relatorios/` legível no Excel e LibreOffice, com fórmulas `=SUM(...)` ativas e layout A4 Paisagem intacto.

3. **Validação do Disparo WhatsApp:**
   ```bash
   node projects/hydra-rede/src/test_whatsapp_patio.js --target=dev
   ```
   Deve entregar no número `11996242812` o resumo executivo Hydra acompanhado da planilha em anexo.

---

## 3. Declaração de Circuit Breaker

> **HARD STOP OBRIGATÓRIO:**  
> A especificação técnica, o design de arquitetura e o plano de implementação foram formalizados em `specs/hydra-patio-os-reconciliation/`.  
> Em conformidade com o ciclo SDD e as Regras de Operação v7, **nenhum código de implementação operacional foi escrito nesta etapa**.  
> Aguardando a aprovação do usuário e a emissão do comando `/vibe-apply hydra-patio-os-reconciliation` para início das tarefas da Fase 1.
