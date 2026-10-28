# Plano de Implementação — Spec 042: Hydra Rede Dupla Verificação Anti-Cascata e Blindagem S3

## Estrutura do Plano de Execução (SDD + Alethe)

- [x] [PARALLEL: worker-auditor] Criar módulo `projects/hydra-rede/src/double_check_auditor.js`:
  - Implementar `calcularHashArquivo`, `extrairECsDoExcelBruto`, `gerarAssinaturaTransacoes`.
  - Implementar `validarLojaContraRede` com comparação dual (dia-alvo vs arquivo completo) e tolerância de R$ 0,05.
  - Implementar `executarDuplaVerificacaoGlobal` com verificação de 10/10 lojas, integridade de datas e detecção de arquivos clonados.
- [x] [PARALLEL: worker-tests] Criar suíte de testes `projects/hydra-rede/tests/test_dupla_verificacao.js`:
  - Modo `--unit` com 4 cenários de mutação (Caminho Feliz, Faltou JB+DP, Arquivo Clonado Loja x Loja, Divergência Bruto/Líquido).
  - Modo `--daily` para auditoria do estado real antes do despacho.
- [x] [LEAD] Atualizar `projects/hydra-rede/src/excel_processor.js` para expor `totalBrutoArquivo`, `totalLiquidoArquivo` e `transacoesArquivo` nos stats retornados por `processarRelatorioRede`.
- [x] [LEAD] Atualizar `projects/hydra-rede/src/state_manager.js` para salvar e carregar `resumoRede` em `recordStoreSuccess`.
- [x] [LEAD] Refatorar `projects/hydra-rede/src/scraper.js`:
  - Implementar `navegarECapturarResumoRede(page, loja, targetDatesInfo)` com interceptação de API e extração resiliente de DOM.
  - Implementar `exportarExcelBlindado(page, loja, targetDatesInfo)` com fila S3 blindada por `pvCode === loja.ec`.
  - Aplicar o fluxo blindado com validação in-flight no **loop principal** e na **segunda passada de contingência**.
  - Conectar Gatekeeper Global com invalidação de checkpoints via `recordStoreFailure` antes do bloqueio de consolidação.
  - Exportar aliases legados no `module.exports`.
- [x] [LEAD] Executar bateria de testes localmente via `node tests/test_dupla_verificacao.js --unit`.
- [x] [LEAD] Sincronizar alterações com a VPS operacional (`operacional@100.126.50.101:/home/operacional/hydra-rede/`) e validar execução de teste remota.
- [x] [LEAD] Build gate & Hard stop.
