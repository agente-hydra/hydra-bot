# Proposta de Engenharia — Spec 082: Consolidação do Coletor Único da Rede, Fixação do Invisible Playwright 0.45.0 e Documentação Operacional

## 1. Problema e Diagnóstico

Durante a rotina matinal da Rede de 10/11/2026, identificou-se uma série de inconformidades operacionais decorrentes da coexistência de múltiplos fluxos de execução, scripts fragmentados e conflito de ambientes na VPS (`operacional@100.126.50.101`):

1. **Conflito Dual de Ambientes Python (0.43.0 vs 0.45.0):**
   - O Python do sistema (`/usr/bin/python3`) continha o pacote obsoleto `invisible-playwright 0.43.0` em `~/.local/lib/python3.13/site-packages` (atrelado ao binário antigo `firefox-53`).
   - O ambiente isolado homologado reside em `/home/operacional/.venv-invisible/bin/python` com `invisible-playwright 0.45.0` (atrelado a `firefox-55`).
   - Em `projects/hydra-rede/src/invisible_bridge_client.js:48-61`, a rotina de descoberta de executável (`_resolvePythonPath`) não incluía o caminho explícito `/home/operacional/.venv-invisible/bin/python`, fazendo com que execuções disparadas fora do diretório home utilizassem o Python do sistema (0.43.0). Isso causava locks e timeouts de 180s no perfil persistente `.rede_firefox_profile/firefox_data`.

2. **Desconexão entre o Worker Daemon e a Extração Viva via Fila S3:**
   - O daemon IPC `projects/hydra-rede/src/invisible/rede_invisible_worker.py` no handler `EXPORT_STORES_BATCH` operava como um stub sintético que não executava a troca real de lojas e o download via fila S3 (`/api/fl2/prd/v1/downloads/queue`), bloqueando a geração em produção com `Falha na extração viva da loja ... Geração de arquivo sintético BLOQUEADA`.
   - Em contrapartida, a extração real e homologada residia isolada em `projects/hydra-rede/src/invisible/homologated_contingency_collector.py` (e foi utilizada no script de recuperação `/tmp/rede-0911-4i31woz2/collect_live_v2.py`).

3. **Multiplicidade de Processos Concorrentes na VPS:**
   - O PM2 executava serviços redundantes:
     - `rede-session-keeper` (id 9, `src/rede_session_keeper.js`): Serviço legado que tentava manter cookies via requisições HTTP avulsas em `storageState_rede.json`, concorrendo e dessincronizando com o perfil nativo do Firefox Gecko.
     - `rede-live-auth` (id 10, `src/reconnect_system/rede_live_auth_hub.js`): Hub de reconexão assistida.
     - Daemons órfãos na porta TCP 49222 e processos remanescentes do Firefox retendo travas de arquivo.

4. **Incompatibilidade de API em `session_guard.py`:**
   - Uso indevido de `await el.is_visible()` sobre instâncias de `ElementHandle` (método inexistente no `invisible-playwright`), gerando erros como `ElementHandle has no method 'isVisible'`.

5. **Ausência de Documentação Técnica e Operacional Centralizada:**
   - A operação não dispõe de um manual consolidando: arquitetura de processos, crons agendados, ciclo de vida dos dados (desde login, S3 queue, download, processamento, conciliação e envio no WhatsApp), localização de diretórios e procedimentos de verificação operacional.

---

## 2. Solução Proposta

1. **Unificação Estrita do Ambiente Python no Invisible Playwright 0.45.0:**
   - Atualizar `src/invisible_bridge_client.js` para priorizar e exigir `/home/operacional/.venv-invisible/bin/python`.
   - Corrigir `src/invisible/session_guard.py` para utilizar `Locator.is_visible()` ou `bounding_box()` seguro.
   - Na VPS, remover os pacotes residuais `0.43.0` de `~/.local` e limpar caches de binários obsoletos do Firefox.

2. **Consolidação da Coleta Real de Lojas S3 no Worker Único:**
   - Integrar a lógica viva de navegação e polling da fila S3 (`selecionar_estabelecimento`, requisições na fila `/api/fl2/prd/v1/downloads/queue` e download dos arquivos `.xlsx`) diretamente em `src/invisible/rede_invisible_worker.py` e harmonizar com `src/scraper.js` e `src/invisible/homologated_contingency_collector.py`.
   - Garantir que tanto o fluxo agendado de lote quanto intervenções pontuais utilizem o mesmo motor sem stubs sintéticos.

3. **Saneamento Operacional de Serviços na VPS:**
   - Desativar e remover o serviço legado `rede-session-keeper` do PM2 (já obsoleto devido ao ciclo persistente do Invisible 0.45).
   - Encerrar processos zumbis na porta 49222 e liberar locks do diretório `.rede_firefox_profile`.
   - Manter no PM2 unicamente o ecossistema necessário e estável (`hydra-qr-hub`, `hydra-reconnect-watchdog`, `rede-live-auth`).

4. **Elaboração da Documentação Arquitetural e Operacional Completa:**
   - Criar `projects/hydra-rede/docs/ARQUITETURA_OPERACIONAL_REDE.md` cobrindo:
     - Visão geral da arquitetura (Node.js + Python Invisible 0.45 + Firefox Gecko Patched).
     - Mapa de diretórios, arquivos-chave e suas funções.
     - Mapa de Crons (horários, comandos, logs gerados).
     - Mapa de Processos PM2 (portas, papéis, comandos de manutenção).
     - Fluxo ponta a ponta dos dados (Auth -> S3 Polling -> Download -> Processamento -> Auditoria de Lote -> Disparo WhatsApp).
     - Runbook de operação manual e comandos de diagnóstico/conferência.

---

## 3. Especialistas Envolvidos

- **Líder (Single-Agent Orchestrator):** Arquitetura geral, saneamento de serviços, integração Node/Python, governança SDD e validação E2E.
- **`specialist-crawler-rede`:** Especialista em automação do portal Rede, bridge TCP, manipulação da fila S3 de downloads e documentação técnica.

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Interrupção no cron das 05:00 / 07:00 | Falha no relatório matinal de amanhã | Os crons canônicos chamam `src/cron_rede.js` e `src/index.js`, que permanecem inalterados na interface pública, consumindo agora a infraestrutura unificada e estável. |
| Perda de cookies / logout forçado | Exigência de novo login no noVNC | O perfil persistente em `.rede_firefox_profile` e `data/stealth_profile` é preservado; a remoção de locks concorrentes restaura a estabilidade da sessão. |
| Envio indevido de mensagens | Violação da Regra de Ouro WhatsApp | O pipeline de mensageria continua restrito unicamente às instâncias `hydra` e `atendimento`, sem qualquer envio para gerentes. |
