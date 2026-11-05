# Plano de Execução — Spec 071: Migração da Rede para Invisible Playwright

## Estratégia de Execução
- **Especialistas Ativados:**
  - `specialist-crawler-rede`: Desenvolvimento do worker Python Invisible (`rede_invisible_worker.py`), rotinas de extração, tolerância a pop-ups e guarda de sessão.
  - `specialist-ops-infra`: Script de provisionamento do ambiente `.venv-invisible` (Invisible Playwright 0.45.0, fetch do Firefox) e integração no PM2 da VPS.
  - `[LEAD]`: Ponte IPC em Node (`invisible_bridge_client.js`), refatoração de `scraper.js` e `rede_live_auth_hub.js`, manifesto de lote e testes E2E.
- Cada tarefa só é marcada como `[x]` com comando de validação determinístico registrado em `evidence/t<n>.md`.

---

## Tasks

- [x] [SPECIALIST:specialist-ops-infra] **T1 — Provisionamento do Ambiente Invisible Playwright 0.45.0**
  - Criar `projects/hydra-rede/deploy/setup_invisible_env.sh` para criação do venv com Python 3.11+, instalação de `invisible-playwright==0.45.0`, `invisible-core==55.50.0` e execução de `invisible-playwright fetch`.
  - Criar manifesto de versões e hashes de integridade em `projects/hydra-rede/deploy/invisible_manifest.json`.
  - **Aceite:** Script valida instalação e `python -c "import invisible_playwright; print(invisible_playwright.__version__)"` retorna `0.45.0`.

- [x] [SPECIALIST:specialist-crawler-rede] **T2 — Worker Python Unificado & Guarda de Sessão**
  - Implementar `projects/hydra-rede/src/invisible/session_guard.py`: detecção de login ativo por elementos reais do relatório de vendas e código de EC no cabeçalho; descarte de tutoriais/pop-ups conhecidos.
  - Implementar `projects/hydra-rede/src/invisible/manifest_tracker.py`: geração e tracking de `batch_manifest.json` com cálculo SHA-256 por arquivo.
  - Implementar `projects/hydra-rede/src/invisible/rede_invisible_worker.py`: daemon único com protocolo IPC JSON-RPC via stdin/stdout ou socket local, controle do perfil persistente e suporte a modo headless e headed assistido no display `:99`.
  - **Aceite:** Teste unitário do worker responde a ping JSON-RPC e valida perfil persistente.

- [x] [LEAD] **T3 — Cliente de Ponte IPC Node.js (`invisible_bridge_client.js`)**
  - Implementar `projects/hydra-rede/src/invisible_bridge_client.js`: inicializa e comunica com o worker Python Invisible via child_process spawn com reinício automático e timeout de segurança.
  - Suportar métodos assíncronos: `checkSession()`, `exportBatch(stores, period)`, `requestAssistedAuth()`, `close()`.
  - **Aceite:** Teste de integração Node ↔ Python executa handshake e recebe status de sessão.

- [x] [LEAD] **T4 — Migração de `scraper.js` e `rede_live_auth_hub.js`**
  - Refatorar `projects/hydra-rede/src/scraper.js` para utilizar `invisible_bridge_client.js` no lugar de `chromium.launch` direto.
  - Refatorar `projects/hydra-rede/src/reconnect_system/rede_live_auth_hub.js` para delegar o display assistido ao worker Invisible em vez de instanciar segundo browser paralelo.
  - Garantir liberação estrita de lock e encerramento de processos órfãos em caso de timeout.
  - **Aceite:** `scraper.js` executa ciclo de exportação chamando o worker Invisible sem lançar Chromium paralelo.

- [x] [LEAD] **T5 — Manifesto de Lote & Enlace com Auditoria Financeira**
  - Validar que o lote de 10 lojas gera `batch_manifest.json` contendo os 10 hashes e o selo criptográfico do período.
  - Conectar a conciliação financeira e o despacho via WhatsApp ao selo de lote aprovado (bloqueio incondicional em caso de lote incompleto).
  - **Aceite:** Validador rejeita conciliação com menos de 10 lojas confirmadas e aprova lote completo.

- [x] [LEAD] **T6 — Validação E2E com Suíte de Ensaios E1..E5**
  - Executar a bateria de ensaios da tabela de validação (dois gatilhos simultâneos, recuperação de timeout, detecção de pop-up e geração de lote).
  - Registrar evidências completas em `specs/071-rede-migracao-invisible-playwright/evidence/`.
  - **Aceite:** Todos os 5 ensaios aprovados com exit code 0.
