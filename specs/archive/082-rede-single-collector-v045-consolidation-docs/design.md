# Design Técnico — Spec 082: Arquitetura Unificada do Coletor Rede e Documentação Operacional

## 1. Visão Arquitetural

```
+-----------------------------------------------------------------------------------+
|                               VPS OPERACIONAL (100.126.50.101)                   |
|                                                                                   |
|  +-------------------+       +-----------------------+     +-------------------+  |
|  |   CRONTAB         |       |   PM2 SERVICES        |     |   RECONNECT HUB   |  |
|  |   05:00 Coleta    |       |   - hydra-qr-hub (7)  |     |   Port 3899       |  |
|  |   05:45 Auditoria | ----> |   - watchdog (8)      | --> |   noVNC 6080      |  |
|  |   07:00 Disparo   |       |   - rede-auth-hub(10) |     |   Display :99     |  |
|  +-------------------+       +-----------------------+     +-------------------+  |
|                                          |                                        |
|                                          v                                        |
|                          +-------------------------------+                        |
|                          |   src/invisible_bridge_client |                        |
|                          |   (Node.js IPC Client)        |                        |
|                          +-------------------------------+                        |
|                                          | TCP 127.0.0.1:49222                    |
|                                          v                                        |
|                          +-------------------------------+                        |
|                          |   .venv-invisible/bin/python  |                        |
|                          |   invisible-playwright 0.45.0 |                        |
|                          |   rede_invisible_worker.py    |                        |
|                          +-------------------------------+                        |
|                                          |                                        |
|                                          v                                        |
|                          +-------------------------------+                        |
|                          |   Firefox Patched (Gecko 55)  |                        |
|                          |   Perfil: .rede_firefox_prof. |                        |
|                          +-------------------------------+                        |
|                                          |                                        |
|                        +-----------------+-----------------+                      |
|                        |                                   |                      |
|                        v                                   v                      |
|             +-----------------------+           +----------------------+          |
|             | Portal Meu Rede       |           | Fila S3 Downloads    |          |
|             | 10 ECs Selecionados   | --------> | /api/fl2/prd/v1/     |          |
|             +-----------------------+           | downloads/queue      |          |
|                                                 +----------------------+          |
|                                                            |                      |
|                                                            v                      |
|                                                 +----------------------+          |
|                                                 | 10 Arquivos .xlsx    |          |
|                                                 | downloads/           |          |
|                                                 +----------------------+          |
|                                                            |                      |
|                                                            v                      |
|                                                 +----------------------+          |
|                                                 | Processamento Excel  |          |
|                                                 | Matriz 10x Sem Juros |          |
|                                                 | Dupla Verificação    |          |
|                                                 | Auditoria APROVADA   |          |
|                                                 +----------------------+          |
|                                                            |                      |
|                                                            v                      |
|                                                 +----------------------+          |
|                                                 | Disparo WhatsApp     |          |
|                                                 | Instância: hydra     |          |
|                                                 | Fin: 5 relatórios    |          |
|                                                 | Davi: Conciliação    |          |
|                                                 +----------------------+          |
+-----------------------------------------------------------------------------------+
```

---

## 2. Componentes e Modificações Detalhadas

### 2.1. `src/invisible_bridge_client.js`
- **Problema:** Lista `candidatePaths` em `_resolvePythonPath` não possuía `/home/operacional/.venv-invisible/bin/python`, caindo no python global da VPS (`/usr/bin/python3`) com `invisible-playwright 0.43.0`.
- **Ajuste:** Inserir `/home/operacional/.venv-invisible/bin/python` no topo da lista de candidatos prioritários.
- **Contrato:**
  ```javascript
  const candidatePaths = [
    '/home/operacional/.venv-invisible/bin/python',
    '/opt/hydra-rede/invisible-env/bin/python',
    '/home/ubuntu/.venv-invisible/bin/python',
    path.join(process.cwd(), '.venv-invisible', 'bin', 'python'),
    ...
  ];
  ```

### 2.2. `src/invisible/session_guard.py`
- **Problema:** Métodos invocavam `await el.is_visible()`, gerando erro `ElementHandle has no method 'isVisible'`.
- **Ajuste:** Substituir chamadas em `ElementHandle` por medição segura de caixa delimitadora (`box = await el.bounding_box(); if box and box['width'] > 0 and box['height'] > 0: ...`) ou locators nativos.

### 2.3. `src/invisible/rede_invisible_worker.py`
- **Problema:** Comando `EXPORT_STORES_BATCH` realizava apenas verificação de arquivo em disco e emitia erro sintético.
- **Ajuste:** Incorporar as rotinas reais de extração:
  - `selecionar_estabelecimento(page, loja)`: navegação, clique no seletor de EC, scroll e confirmação no cabeçalho.
  - `extrair_relatorio_loja(page, loja, date_period, output_dir)`: clique em exportar Excel, polling na fila S3 `/api/fl2/prd/v1/downloads/queue`, download do `.xlsx` real e registro com hash e contagem.
- **Tratamento de Sessão:** Caso a sessão expire durante o lote, acionar reconexão stealth imediata (`garantir_sessao_rede`) sem travar o worker.

### 2.4. Limpeza e Unificação de Processos na VPS
- **Remoção de Legados PM2:**
  - `rede-session-keeper` (id 9): remover via `pm2 delete rede-session-keeper`. O ciclo de vida de cookies agora é 100% mantido pela sessão persistente Gecko do Invisible Playwright.
- **Eliminação de Pacotes Concorrentes:**
  - Remover `/home/operacional/.local/lib/python3.13/site-packages/invisible_playwright*`.
  - Remover binários órfãos de Firefox 53 em `/home/operacional/.cache/ms-playwright/firefox-53*`.
- **Higiene de Processos e Locks:**
  - Terminar instâncias zumbis de `python` e `firefox` que estejam segurando `.rede_firefox_profile/firefox_data/lock`.

---

## 3. Especificação do Documento Operacional (`ARQUITETURA_OPERACIONAL_REDE.md`)

O documento será salvo em `projects/hydra-rede/docs/ARQUITETURA_OPERACIONAL_REDE.md` e conterá:
1. **Identificação e Finalidade do Sistema:** O que é o bot da Rede, lojas atendidas (10 ECs), rotinas diárias.
2. **Topologia de Infraestrutura:** Servidor VPS (`100.126.50.101`), diretórios principais (`/home/operacional/hydra-rede`, `/home/operacional/hydra-data/`, `/home/operacional/.venv-invisible/`).
3. **Mapa de Processos PM2:** Nome, comando, porta, função de cada serviço ativo.
4. **Mapa de Crons:** Tabela com minuto, hora, comando, log de saída e objetivo.
5. **Ciclo de Vida da Coleta Diária (Passo a Passo):**
   - 05:00: Acionamento via `cron_rede.js` -> `scraper.js` -> `rede_invisible_worker.py`.
   - 05:05 - 05:35: Varredura dos 10 ECs, trigger no portal, polling na fila S3 da Rede, download dos 10 `.xlsx`.
   - 05:35: Processamento contábil dos 10 arquivos via `excel_processor.js` (com matriz de 10x sem juros).
   - 05:40: Geração da planilha consolidada canônica `Juros Rede - DD-MM-AAAA.xlsx`.
   - 05:45: Auditoria pré-disparo (`audit_rede_pre_dispatch.js`), verificação de selo em `hydra-data/locks/rede_audit_passed_DD-MM-AAAA.json`.
   - 07:00: Disparo WhatsApp via `hydra` (5 relatórios para Financeiro, Conciliação para Davi).
6. **Procedimentos de Contingência e Manual Runbook:**
   - Como forçar coleta manual de uma data específica.
   - Como abrir o painel de noVNC para intervenção visual humana (se necessário).
   - Como rodar apenas a auditoria ou apenas o disparo.
   - Checklist de integridade pós-falha.
