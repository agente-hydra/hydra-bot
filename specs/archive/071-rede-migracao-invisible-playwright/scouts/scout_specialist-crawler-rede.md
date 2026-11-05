---
specialistId: specialist-crawler-rede
specId: 071-rede-migracao-invisible-playwright
complexity: ALTA
anchors: ["projects/hydra-rede/src/scraper.js:17", "projects/hydra-rede/src/scraper.js:864", "projects/hydra-rede/src/reconnect_system/rede_live_auth_hub.js:15", "projects/hydra-rede/src/reconnect_system/rede_live_auth_hub.js:114"]
---
Diagnóstico de Crawler & Sessão Rede:
1. Fragmentação de Executores: O coletor batch (scraper.js) e o hub de autenticação assistida (rede_live_auth_hub.js) operam instâncias desacopladas de Chromium com playwright-extra e playwright padrão, gerando concorrência de storageState e falso-positivos em mudanças de layout.
2. Migração para Invisible Playwright 0.45.0 (Python / Firefox patched):
   - Necessário encapsular o navegador em um daemon/worker Python único com perfil persistente isolado.
   - O Node.js atua como orquestrador via IPC / child_process / stdin-stdout estruturado JSON-RPC.
   - Em caso de CAPTCHA ou desafio, o worker pausa e cede o display/noVNC ao operador sem perder o contexto de cookies.
3. Validação de Sessão Forte:
   - Substituir verificação de HTTP 200 por conferência física de elementos do relatório de vendas e cabeçalho de EC.
   - Trava de lote: exportar os 10 estabelecimentos com manifesto de hash antes de liberar para conciliação.
