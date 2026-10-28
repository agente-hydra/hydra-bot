# Plano de Implementação — Spec 044: Prevenção contra Duplicação e Contaminação entre Lojas

## Tarefas de Implementação

- [ ] [EXCEL] Atualizar `projects/hydra-rede/src/excel_processor.js` (Camada 1):
  - Adicionar o parâmetro `ecEsperado = null` na assinatura de `processarRelatorioRede(filePath, targetDatesInfo, nomeLoja = '', ecEsperado = null)`.
  - Implementar localização dinâmica da coluna de EC (`número do estabelecimento`, `código ec`, `ec`).
  - Implementar checagem linha a linha: rejeitar categoricamente com `[CONTAMINAÇÃO DE EC]` se qualquer linha de transação contiver EC diferente de `ecEsperado`.
  - Manter compatibilidade com chamadas legadas que não informem `ecEsperado`.

- [ ] [STATE] Atualizar `projects/hydra-rede/src/state_manager.js` (Camada 2):
  - Implementar trava de colisão de hash SHA-256 dentro de `recordStoreSuccess`:
    - Varre lojas já registradas com `status === 'SUCCESS'`.
    - Se encontrar outra loja com exatamente o mesmo `fileSha256` e com `transacoesCount > 0`, rejeita a gravação e lança `[COLISÃO SHA-256]`.
  - Persistir explicitamente `fileSha256` e `txSignature` no registro da loja.

- [ ] [SCRAPER] Atualizar `projects/hydra-rede/src/scraper.js` (Integração das 3 Camadas):
  - Atualizar as 3 invocações de `processarRelatorioRede` (Loop Principal, Rodada de Contingência e Consolidação Final) passando `loja.ec`.
  - Tratar a exceção `[CONTAMINAÇÃO DE EC]` e `[COLISÃO SHA-256]` no bloco de captura de erros da loja, gravando a falha no estado e disparando retry/alerta.
  - Assegurar que qualquer arquivo rejeitado por contaminação ou colisão seja expurgado de `downloads/` imediatamente.

- [ ] [TESTS] Criar `projects/hydra-rede/tests/test_duplication_and_contamination.js`:
  - Teste 1 (Camada 1): Validação de EC interno em `processarRelatorioRede` (arquivo com 10 linhas corretas e 1 linha contaminada -> deve lançar erro).
  - Teste 2 (Camada 2): Detecção de colisão de hash SHA-256 em `state_manager.js` ao tentar registrar o mesmo arquivo físico com vendas para duas lojas distintas.
  - Teste 3 (Camada 3): Rejeição de divergência Tela vs. Arquivo em `double_check_auditor.js` (valores divergentes da tela da Rede reprovam no Gate 1 e no Gate 2).
  - Teste 4: Verificação de coexistência pacífica de múltiplas lojas com 0 vendas (domingos/feriados).

- [ ] [RUNNER] Integrar no runner unificado `projects/hydra-rede/tests/run_all_tests.js`:
  - Adicionar a suíte de Duplicação e Contaminação no array `SUITES`.
  - Executar bateria completa localmente (`npm run test:all`).

- [ ] [VPS] Sincronizar com a VPS operacional (`operacional@100.126.50.101:/home/operacional/hydra-rede/`):
  - Transferir arquivos atualizados via SCP.
  - Executar a suíte unificada na VPS e atestar 100% de aprovação.

- [ ] [GATE] Validação final e Hard Stop.
