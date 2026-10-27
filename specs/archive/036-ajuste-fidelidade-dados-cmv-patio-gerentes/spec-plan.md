# Plano de Implementação: Spec 036 — Ajuste de Fidelidade de Dados de CMV, Faturamento, Metas, Pátio Ativo e Alerta de Serviço Prestado

## Tasks de Implementação

- [x] [DATA/AREAS] Atualizar `carregarDadosCmvEMetas` em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Extrair `servicoPrestadoFat` e `servicoPrestadoPct` da área `SERVIÇO PRESTADO` em `relatorio_operacao_<slug>.json` e da tabela SQLite `faturamento_areas`.
  - Priorizar leitura de `relatorio_operacao_*.json` e `metas_rede.json` como fontes primárias de verdade.
- [x] [DISPATCHER] Atualizar `classifyKPI` e formatação visual em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Definir emoji de Bom como `🔵` (bolinha azul).
  - Manter `🟢` (Dentro do Objetivo), `🟡` (Alerta), `🔴` (Fora do Objetivo) e `🚨` (Crítico).
  - Remover textos explicativos `(BOM)`, `(DENTRO DO OBJETIVO)`, etc.
- [x] [DISPATCHER] Refatorar `formatarMsgCmvKpiGerente` em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Remover definitivamente o bloco de citação `> *FAIXAS DE CMV (DIRETORIA)*`.
  - Exibir Faturamento Acumulado e Meta do Mês em linhas dedicadas:
    `- _Faturamento Acumulado:_ *R$ 71.640,61*`
    `- _Meta do Mês:_ *R$ 99.900,00* (-16%)`
  - Inserir linha de Serviço Prestado:
    `- _Serviço Prestado:_ 🔴 *44,48%*` (quando < 45%) ou `🟢 *51,36%*` (quando >= 45%).
  - Limpar avisos poluídos do bloco de pátio e checklists.
- [x] [DISPATCHER/SOCIOS] Criar função `formatarAlertaSociosServicoPrestado` em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Montar balão executivo compilando as unidades com participação de Serviço Prestado abaixo do piso de 45%.
- [x] [ORCHESTRATOR] Atualizar `projects/hydra-rede/src/run_cmv_kpi_gerentes.js`:
  - Após os disparos individuais para os gerentes, verificar se existem lojas com `servicoPrestadoPct < 45%`.
  - Se houver, disparar o balão executivo para o Grupo dos Sócios (`120363425738307789@g.us`).
  - Redirecionar para `--target=dev` (Davi `5511996242812`) durante testes ou simular em `--dry-run`.
- [x] [DATA/PATIO] Sincronizar pátio ativo no ambiente da VPS:
  - Garantir atualização de `os_store_MPrudge.json` com os 4 carros em aberto do ERP ao vivo para eliminar a defasagem de 12 para 4 OSs.
- [x] [TESTS] Atualizar suíte de testes em `projects/hydra-rede/src/test_cmv_kpi_gerentes.js`:
  - Validar remoção das faixas de diretoria.
  - Validar bolinha azul `🔵` e ausência de texto `(BOM)`.
  - Validar semáforo de Serviço Prestado (<45% vermelho, >=45% verde).
  - Validar balão do grupo dos sócios quando há unidades críticas.
  - Executar suíte completa (`node src/test_cmv_kpi_gerentes.js` e `node scripts/suite_testes_integridade.js`).
- [x] [PREVIEW] Disparar novo preview no WhatsApp para o Davi (`5511996242812`):
  - Validar o aviso do gerente (Kennedy e Rudge) e o alerta do grupo dos sócios via instância permitida `hydra`.
