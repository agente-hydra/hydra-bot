# Plano de Execução — Spec 077: Header em Ilha Flutuante Apple iOS com Física Elástica e Otimização Mobile

## Tarefas

- [x] [LEAD] **T1 — Markup e Estilização da Ilha Flutuante Apple (`#floatingIslandHeader`) e Padding dos Viewports**
  - Substituir o `<header>` retangular fixo por `<header id="floatingIslandHeader">` flutuante com bordas `rounded-full`, backdrop-blur vítreo ultra-fino, sombra de elevação profunda e posicionamento dinâmico com `env(safe-area-inset-top)`.
  - Ajustar botões `#btnSyncNow`, `#btnDemoMenu` e `#btnLock` para o formato de micro-pílulas táteis com touch target de 38px e ícones calibrados para evitar qualquer espremimento em telas mobile.
  - Atualizar os paddings de topo das 4 seções de abas (`#tabLeads`, `#tabAnalytics`, `#tabAds`, `#tabWebhook`) de `pt-4` para `pt-20` para que o conteúdo inicie com respiro perfeito abaixo da ilha flutuante.
  - **Aceite:** `node -e "const fs = require('fs'); const h = fs.readFileSync('./projects/hydra-rede/src/leads_system/public/index.html','utf8'); if (!h.includes('floatingIslandHeader') || !h.includes('pt-20')) process.exit(1); console.log('T1_OK');"`

- [x] [LEAD] **T2 — Animações Apple Spring Physics (Entrada, Spin do Sync e Expansão do Dropdown)**
  - Implementar animação `@keyframes islandIn` com curva cúbica Apple `cubic-bezier(0.16, 1, 0.3, 1)`.
  - Implementar classe `.sync-spin` e feedback tátil elástico `active:scale-95` com spring nos botões da ilha.
  - Animar a abertura e fechamento de `#demoDropdown` como expansão fluida da própria ilha com cantos arredondados de 16px e sombra vítrea.
  - **Aceite:** `node -e "const fs = require('fs'); const h = fs.readFileSync('./projects/hydra-rede/src/leads_system/public/index.html','utf8'); if (!h.includes('islandIn') || !h.includes('sync-spin')) process.exit(1); console.log('T2_OK');"`

- [x] [LEAD] **T3 — Validação E2E em `test_leads_system.js`, Deploy na VPS e Verificação em Produção**
  - Atualizar `test_leads_system.js` com asserções para `#floatingIslandHeader` e funcionamento intacto de sincronização e dropdown.
  - Executar a suíte de testes E2E localmente.
  - Fazer deploy dos arquivos na VPS (`100.126.50.101`), reiniciar `hydra-leads-hub` no PM2 e verificar a ilha flutuante online em `https://bot.tork.services/leads`.
  - **Aceite:** `node projects/hydra-rede/src/leads_system/test_leads_system.js`
