# Plano de Implementação — Spec 046: Fix de Interceptação de Modal de Lojas e Eliminação de Falso-Positivo In-Flight no Hydra Rede

- [x] 1. **[SCRAPER] Bypass Inteligente de Pointer-Events no Seletor de Estabelecimentos**
  - Implementar função `isModalEstabelecimentosAberto(page)` em `projects/hydra-rede/src/scraper.js` checando a presença e dimensões visíveis de `modal-default[modalid*="change"]`, `.modalchangebrand`, `.modal.fade.in`.
  - Em `selecionarEstabelecimento(page, loja)`, verificar se o modal já está aberto: se sim, pular o clique em `.c-header__wrapper-establishment` e avançar direto para a seleção do radio button.
  - Usar `{ force: true }` no clique do botão do cabeçalho caso o modal esteja fechado.
  - Suportar abertura via gaveta lateral (`#main-button-change-establishment` ou `a.changebrand`) caso o modal `.modalchangebrand` ainda não tenha aberto após o clique no cabeçalho.

- [x] 2. **[SCRAPER] Auto-Recuperação de Modal Travado e Desmonte Pós-Aplicação**
  - Adicionar rotina de escape/fechamento do modal caso a busca por radio button esgote os 12 ciclos de scroll virtual.
  - No clique de `btnAplicar`, acionar com `{ force: true }` e aguardar que o modal saia da tela via `waitForFunction` antes de retornar.

- [x] 3. **[SCRAPER] Sanitização de Coerência Contábil no Resumo da Rede**
  - Em `navegarECapturarResumoRede(page, loja, targetDatesInfo)` em `projects/hydra-rede/src/scraper.js`:
  - Se `liquido > bruto`, classificar o resumo do DOM como `DOM_INCOERENTE` e descartar os valores para evitar contaminação por saldo bancário.
  - Restringir seletores do DOM para blocos de vendas (`.sales-summary`, `[class*="vendas"]`, `table`).

- [x] 4. **[AUDITOR] Ajuste Temporalmente Consciente no `validarLojaContraRede`**
  - Em `projects/hydra-rede/src/double_check_auditor.js`:
  - Validar `resumoRede.brutoEsperado` contra `stats.totalBruto` (corte diário) OU `stats.totalBrutoArquivo` (total semanal do arquivo da Rede).
  - Se bater com qualquer um dos dois (com margem de tolerância de R$ 0,05), aprovar a loja.
  - Impedir `fs.unlinkSync` quando o arquivo baixado tiver linhas íntegras do EC correto.

- [x] 5. **[INDEX] Trava Anti-Fallback de Planilhas Legadas**
  - Em `projects/hydra-rede/src/index.js`, garantir que, em caso de bloqueio ou erro, nenhuma planilha antiga de datas anteriores seja copiada ou renomeada para o Desktop ou para a pasta `output/`.

- [x] 6. **[TESTS] Teste Unitário e Validação da Suíte**
  - Adicionar teste em `projects/hydra-rede/tests/test_double_check_auditor.js` simulando resumo semanal da Rede com dados diários filtrados.
  - Executar suíte completa: `node projects/hydra-rede/tests/run_all_tests.js`.

- [x] 7. **[DEPLOY] Sincronização via SCP para a VPS**
  - Enviar `src/scraper.js`, `src/double_check_auditor.js`, `src/index.js` e `tests/` para `operacional@100.126.50.101:/home/operacional/hydra-rede/`.
  - Validar sintaxe remota via `node -c`.

- [x] 8. **[E2E] Execução Real na VPS e Coleta Exclusiva de Hoje**
  - Limpar estado de erro de `2026-10-27` em `data/state_2026-10-27.json` na VPS.
  - Executar esteira oficial na VPS para 27/10/2026 com `--now --dest 5511996242812`.
  - Copiar para o Desktop SOMENTE `Juros Rede - 27-10-2026.xlsx` e o log de execução real.
