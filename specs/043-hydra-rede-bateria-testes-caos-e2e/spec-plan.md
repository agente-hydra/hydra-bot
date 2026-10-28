# Plano de Implementação — Spec 043: Bateria Exaustiva de Testes de Caos, E2E e Resiliência da Dupla Verificação

## Estrutura do Plano de Execução (SDD + Alethe)

- [x] [PARALLEL: worker-unit-edge] Criar suíte `projects/hydra-rede/tests/test_financial_edge_cases.js` (Pilares 3 & 4):
  - Testes de tolerância de centavos de MDR (R$ 0,04 / 0,05 aprovado vs. R$ 0,06 reprovado).
  - Testes de compatibilidade dual de período (range acumulado semanal vs. filtro do dia-alvo).
  - Teste de domingos/feriados com múltiplas lojas `SEM_VENDAS` (sem falso-positivo de vendas repetidas, mantendo trava de arquivo clonado).
  - Teste de agulha no palheiro (injeção de 1 linha de EC intruso no meio de 200 linhas legítimas).
  - Teste de ciclo de vida do estado: invalidação seletiva no Gate 2 gravando `FAILED` no disco apenas para ECs reprovados e validação do `getPendingStores`.
  - Teste de bloqueio estrito de consolidação parcial em caso de falha em qualquer uma das 10 lojas.

- [x] [PARALLEL: worker-playwright-chaos] Criar suíte `projects/hydra-rede/tests/test_playwright_chaos_s3.js` (Pilares 1 & 2):
  - Mock de `page.route` para simular fila S3 (`downloads/queue`):
    - Teste de anti-fallback cego (rejeição de ID pré-existente no baseline de `existingIds`).
    - Teste de colisão de loja anterior (rejeição de item recém-concluído com `pvCode` de outra loja ou `null`).
    - Teste de falha intermitente de baseline (2 erros 500/401 seguidos de 200).
    - Teste de descarte de item com `createdAt` fora da janela temporal pós-clique.
  - Mock de interface e resumo de vendas no Playwright:
    - Teste de prioridade da fonte `API_REDE` (/sales, /summary).
    - Teste de fallback resiliente da fonte `DOM_REDE` (leitura e regex de cards HTML).
    - Teste de modo degradado `NAO_DETECTADO` (mantém validação interna de EC e SHA-256).
    - Teste de desincronização de sessão (Intra-Page Guard detectando EC antigo no cabeçalho antes do clique).

- [x] [PARALLEL: worker-spreadsheet-vps] Criar `projects/hydra-rede/tests/test_spreadsheet_integrity.js` e `tests/test_smoke_vps_history.js` (Pilares 5 & 6):
  - `test_spreadsheet_integrity.js`:
    - Simulação completa de consolidação para as 10 lojas oficiais (`LOJAS`).
    - Verificação de preservação milimétrica de fórmulas via `contarFormulasPlanilha`.
    - Verificação de integridade da cópia canônica oficial `Juros Rede - DD-MM-AAAA.xlsx`.
  - `test_smoke_vps_history.js`:
    - Scanner histórico que lê arquivos reais em `downloads/` e estados em `data/` na VPS.
    - Teste de abertura e extração do layout real de produção contra `extrairECsDoExcelBruto` e `processarRelatorioRede`.

- [x] [LEAD] Criar `projects/hydra-rede/tests/run_all_tests.js` e atualizar `package.json`:
  - Implementar runner unificado que executa todas as suítes e exibe relatório executivo com contagem de testes e tempos de execução.
  - Adicionar script `"test:all": "node tests/run_all_tests.js"` e `"test:chaos": "node tests/test_playwright_chaos_s3.js"` no `package.json`.

- [x] [LEAD] Executar bateria completa localmente:
  - Rodar `node tests/run_all_tests.js` e verificar aprovação de 100% dos testes (Aprovado em 29.50s - 5/5 suítes).

- [x] [LEAD] Sincronizar testes com a VPS operacional (`operacional@100.126.50.101:/home/operacional/hydra-rede/`):
  - Transferir os novos scripts de teste via SCP.
  - Executar a suíte unificada remotamente na VPS (`node tests/run_all_tests.js`) com auditoria histórica em dados reais (Aprovado em 30.04s - 5/5 suítes).

- [x] [LEAD] Build gate final & Hard Stop.
