---
specialistId: specialist-crawler-rede
specId: 082-rede-single-collector-v045-consolidation-docs
complexity: medium
anchors: ["projects/hydra-rede/src/invisible_bridge_client.js:48", "projects/hydra-rede/src/invisible/rede_invisible_worker.py:204", "projects/hydra-rede/src/invisible/homologated_contingency_collector.py:265", "projects/hydra-rede/src/scraper.js:889"]
---

# Scout: Unificação da Coleta Rede, Fixação do Ambiente 0.45.0 e Documentação Operacional

## Diagnóstico
1. **Conflito Dual de Ambientes Python na VPS:** O Python global `/usr/bin/python3` possui `invisible-playwright 0.43.0` instalado em `~/.local`, enquanto o venv isolado `/home/operacional/.venv-invisible/bin/python` possui a versão homologada `0.45.0`. Em `src/invisible_bridge_client.js`, a lista `candidatePaths` não priorizava `/home/operacional/.venv-invisible/bin/python`, permitindo spawn errôneo do 0.43.0 e travamento do perfil Firefox por 180s.
2. **Gap de Implementação no Worker:** `src/invisible/rede_invisible_worker.py` no comando `EXPORT_STORES_BATCH` operava como stub sintético sem realizar a troca de lojas e o download real dos relatórios na fila S3 (`/api/fl2/prd/v1/downloads/queue`), enquanto a lógica de extração real validada residia em `src/invisible/homologated_contingency_collector.py`.
3. **Processos Concorrentes & Legados:** A VPS executa processos paralelos (como `rede-session-keeper` no PM2 id 9, daemons órfãos na porta 49222 e instâncias antigas de navegador) gerando contenção no perfil persistente `.rede_firefox_profile`.
4. **Métodos Incompatíveis em `session_guard.py`:** Uso de `ElementHandle.is_visible()` (inexistente em `invisible-playwright`) causava exceções e status de erro desnecessários.
5. **Déficit Documental:** Ausência de documentação centralizada com mapa de processos, crons, caminhos, ciclo de vida e comandos operacionais de verificação.

## Recomendações
1. Ajustar `src/invisible_bridge_client.js` para priorizar `/home/operacional/.venv-invisible/bin/python` e fixar `0.45.0` em todos os executores.
2. Corrigir checagens de visibilidade em `src/invisible/session_guard.py` utilizando `Locator.is_visible()` ou `bounding_box()`.
3. Integrar a extração real via fila S3 (`selecionar_estabelecimento` e `extrair_relatorio_loja`) diretamente no daemon único `rede_invisible_worker.py`.
4. Saneamento na VPS: expurgar pacotes 0.43.0 residuais, desativar `rede-session-keeper` e unificar ciclo de vida no PM2.
5. Elaborar `docs/ARQUITETURA_OPERACIONAL_REDE.md` com mapa detalhado de processos, rotinas, diretórios, crons e guia de teste/validação.
