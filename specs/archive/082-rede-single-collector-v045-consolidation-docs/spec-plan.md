# Plano de Execução — Spec 082: Consolidação do Coletor Único da Rede, Fixação do Invisible 0.45.0 e Documentação Operacional

## Tarefas de Implementação

- [x] [SPECIALIST:specialist-crawler-rede] **T1 — Unificação do Ambiente Python no Invisible Playwright 0.45.0 e Correção de Session Guard**
  - Em `projects/hydra-rede/src/invisible_bridge_client.js`, atualizar `_resolvePythonPath` inserindo `/home/operacional/.venv-invisible/bin/python` no topo dos caminhos prioritários.
  - Em `projects/hydra-rede/src/invisible/session_guard.py`, substituir todas as chamadas `await el.is_visible()` sobre `ElementHandle` por medições seguras de `bounding_box()` ou locators nativos que não quebrem em runtime.
  - Na VPS, remover pacotes obsoletos `invisible_playwright 0.43.0` em `/home/operacional/.local/lib/python3.13/site-packages` e caches antigos de `firefox-53`.
  - **Aceite:** Execução de `node -e "const { InvisibleBridgeClient } = require('./projects/hydra-rede/src/invisible_bridge_client'); const c = new InvisibleBridgeClient(); console.log('Resolved Python:', c.pythonPath);"` valida a lógica de resolução sem erros.
  - **Aceite (E2E Obrigatório):** Na VPS (`operacional@100.126.50.101`), executar teste de resolução comprovando `/home/operacional/.venv-invisible/bin/python`, versão `0.45.0` do `invisible_playwright` e ausência da versão `0.43.0` no Python do sistema: `ssh operacional@100.126.50.101 "node -e 'const { InvisibleBridgeClient } = require(\"./hydra-rede/src/invisible_bridge_client\"); console.log(new InvisibleBridgeClient().pythonPath)' && /home/operacional/.venv-invisible/bin/python -c 'import invisible_playwright; print(\"VENV:\", invisible_playwright.__version__)'"`

- [x] [SPECIALIST:specialist-crawler-rede] **T2 — Integração da Coleta Real S3 no Worker Daemon Único da Rede**
  - Em `projects/hydra-rede/src/invisible/rede_invisible_worker.py`, no comando `EXPORT_STORES_BATCH`, substituir a lógica de stub sintético pela rotina real homologada:
    - Incorporar `selecionar_estabelecimento(page, loja)` e `extrair_relatorio_loja(page, loja, date_period, output_dir)` com escuta de rede e polling da fila S3 (`/api/fl2/prd/v1/downloads/queue`).
    - Salvar os relatórios `.xlsx` reais baixados no diretório de destino e registrar manifesto com hash e contagem.
    - Manter compatibilidade bidirecional com `src/scraper.js` e `src/invisible/homologated_contingency_collector.py`.
  - Criar teste de integridade local validando o parser e contratos de comando do worker.
  - **Aceite:** Validação de sintaxe estática `node --check projects/hydra-rede/src/scraper.js` e compilação Python `python3 -m py_compile projects/hydra-rede/src/invisible/rede_invisible_worker.py` retornam exit code 0.
  - **Aceite (E2E Obrigatório):** Na VPS, sincronizar arquivos e executar sonda de IPC contra o worker daemon único comprovando recebimento do comando `PING`, `CHECK_SESSION` e despacho de lote real sem travar em stub sintético.

- [x] [SPECIALIST:specialist-crawler-rede] **T3 — Saneamento de Processos Concorrentes e Desativação de Legados na VPS**
  - Desativar e remover do PM2 o serviço legado `rede-session-keeper` (`pm2 delete rede-session-keeper`), unificando o controle de sessão no motor Gecko persistente do Invisible 0.45.
  - Encerrar quaisquer processos zumbis de `rede_invisible_worker.py` e instâncias órfãs de Firefox na VPS, liberando locks em `/home/operacional/hydra-rede/.rede_firefox_profile`.
  - Validar status do PM2 garantindo apenas serviços canônicos ativos (`hydra-qr-hub`, `hydra-reconnect-watchdog`, `rede-live-auth`).
  - **Aceite:** Teste local de scripts e verificação de listas de processos confirmam saneamento.
  - **Aceite (E2E Obrigatório):** Na VPS (`ssh operacional@100.126.50.101`), comando `pm2 jlist` comprova ausência de `rede-session-keeper` e porta 49222 livre ou respondendo estritamente ao daemon único atualizado sem processos duplicados.

- [x] [LEAD] **T4 — Criação da Documentação Arquitetural e Operacional Completa da Rede e Build Gate**
  - Redigir `projects/hydra-rede/docs/ARQUITETURA_OPERACIONAL_REDE.md` com:
    - 1. Finalidade, escopo e lojas (10 ECs mapeados).
    - 2. Topologia de infraestrutura, diretórios físicos e arquivos-chave.
    - 3. Mapa de processos PM2 e papéis.
    - 4. Mapa de Crons (horários, comandos, logs gerados).
    - 5. Fluxo de dados ponta a ponta (Login -> Navegação -> Trigger -> Polling S3 -> Download -> Processamento -> Auditoria -> Disparo WhatsApp).
    - 6. Manual operacional (como rodar coleta manual, como verificar status, como acionar noVNC).
  - Executar Build Gate completo do repositório (`npm run build` / `node --check` / suíte de testes).
  - Sincronizar documentação para a VPS em `/home/operacional/hydra-rede/docs/ARQUITETURA_OPERACIONAL_REDE.md`.
  - **Aceite:** Arquivo `projects/hydra-rede/docs/ARQUITETURA_OPERACIONAL_REDE.md` criado, formatado e com todas as seções descritas.
  - **Aceite (E2E Obrigatório):** Execução do build gate global e verificação da presença física do arquivo de documentação tanto no repositório Git quanto na VPS em `/home/operacional/hydra-rede/docs/ARQUITETURA_OPERACIONAL_REDE.md`.
