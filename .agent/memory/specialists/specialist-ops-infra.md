# Memória do Especialista — Especialista em Ops, Deploy & Backend (specialist-ops-infra)

> Este arquivo registra aprendizados técnicos específicos e duradouros deste especialista.

<!-- sdd:managed:begin id="lessons" -->
<!-- /sdd:managed:end id="lessons" -->

## [2026-11-05] — [Feature: 071-rede-migracao-invisible-playwright]
- **Contexto:** Provisionamento e blindagem do ambiente isolado .venv-invisible com Invisible Playwright 0.45.0 e invisible-core 55.50.0.
- **Regra aprendida:** Configurar explicitamente INVISIBLE_PYTHON_BIN apontando para o binário do venv no .env para evitar colisão com o Python padrão da VPS.
- **Risco identificado:** Execução inadvertida do python global legado (0.43.0) caso o path não seja forçado.
- **Não fazer:** Confiar apenas na leitura de manifestos sem validação do interpretador ativo.
- **Âncora:** `projects/hydra-rede/deploy/setup_invisible_env.sh:30`