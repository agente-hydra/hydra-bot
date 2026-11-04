# Plano de Implementação — Spec 047: Hydra Rede Esteira Pós-Compensação das 05:00 AM, Eliminação de Stale Files Vespertinos e Proteção contra Taxas Arbitrárias

- [x] [LEAD] 1. Isolar `run_evening_heartbeat.js` para modo Probe de Sessão sem poluição de arquivos de produção
  - Alterar o default para `--probe-only`, checando apenas a saúde da sessão Meu Rede e alertando no WhatsApp se houver reCAPTCHA.
  - Se `--salvar-previa` for fornecido, direcionar saída para `output/previa_intradiaria/`, proibindo gravação em `output/Juros Rede - DD-MM-AAAA.xlsx`.

- [x] [LEAD] 2. Implementar Mtime Guard Pós-Meia-Noite em `run_unified_morning_dispatch.js`
  - Criar função `validarFrescuraArquivoJuros` que exige `stat.mtime >= 00:00:00 da data atual (D0)`.
  - Rejeitar arquivos intradiários da véspera com log de `STALE_INTRADAY` e forçar rebuild limpo pós-compensação.

- [x] [LEAD] 3. Blindar `excel_processor.js` contra Alíquotas Arbitrárias e Detectar Pré-Autorizações
  - Remover alíquotas fixas arbitrárias (1.2%, 2.5%, 4.7%) quando `rawLiqStr === '-'` em execuções de D-1 pós-clearing.
  - Capturar sinalizador de link pré-autorizado (`pré-autorizado: sim` / `status: em processamento`) para auditoria de OSs ainda abertas no pátio (caso Mauá).

- [x] [LEAD] 4. Criar Suíte de Testes Unitários de Frescura e Taxas em `tests/test_esteira_horarios_frescura.js`
  - Testar rejeição de arquivos anteriores à meia-noite.
  - Testar aceitação de arquivos pós-meia-noite (05:00 AM).
  - Testar integridade de taxas MDR sem arbitragem fixa.

- [x] [LEAD] 5. Atualizar scripts e crontab na VPS Linux
  - Atualizar `scripts/run-evening-heartbeat.sh` para acionar `--probe-only`.
  - Sincronizar scripts e crontab com a VPS `operacional@100.126.50.101`.
  - Executar suíte completa de testes (`projects/hydra-rede/tests/run_all_tests.js`) e validar gate de integridade.
