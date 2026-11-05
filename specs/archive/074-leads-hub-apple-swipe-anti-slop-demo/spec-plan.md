# Plano de Execução — Spec 074: Física de Swipe Apple iOS, Redesign Anti-Slop & Leads Demo

## Estratégia de Execução
- **Modo de Orquestração:** `solo` (`[LEAD]`, conforme `match_roster.mjs` `k = 0`).
- Cada tarefa só é marcada como `[x]` após execução do comando determinístico de aceite e gravação de evidência em `evidence/t<n>.md`.

---

## Tasks

- [x] [LEAD] **T1 — Gerador & Limpador de Leads Demonstrativos de Todos os Estados (`seed_demo_leads.js` & API)**
  - Criar `projects/hydra-rede/src/leads_system/seed_demo_leads.js` contendo `seedDemoLeads()` (1 exemplar fiel de cada estado: Mandou Mensagem por Código, Mandou Mensagem por Telefone, Redirecionado Aguardando, Perdido sem Mensagem, Perdido sem Redirect e Visitante Ativo na Página, todos com conjuntos de anúncios e dados da Google Tag realistas) e `clearDemoLeads()` (remoção cirúrgica de `visit_id LIKE 'demo_%'`).
  - Atualizar `projects/hydra-rede/src/leads_system/leads_db.js` para retornar `demoCount` no `getDashboardData`.
  - Expor `POST /leads/api/demo/seed` e `POST /leads/api/demo/clear` protegidos por PIN em `projects/hydra-rede/src/leads_system/web_server.js`.
  - **Aceite:** `node --check projects/hydra-rede/src/leads_system/seed_demo_leads.js` e `node --check projects/hydra-rede/src/leads_system/web_server.js` retornam exit code 0.

- [x] [LEAD] **T2 — Motor de Gesto Swipe Horizontal Nível Apple iOS & Spring Physics (`public/index.html`)**
  - Substituir a troca seca de abas por um **Horizontal Swipe Pager GPU-composited (`translate3d`)** com rastreamento 1:1 do dedo no mobile e pointer no desktop.
  - Implementar **Direction Lock** nos primeiros pixels (`|dx| > |dy| * 1.25`) para nunca conflitar com o scroll vertical da lista de leads, além de **Apple Rubber-Band Resistance** nas extremidades.
  - Implementar **Damped Harmonic Spring Solver (`stiffness: 380, damping: 36, mass: 0.9`)** preservando a velocidade inicial do gesto (`vx`), sincronizado 1:1 com uma **Liquid Sliding Pill** na barra inferior e **Drag-to-Dismiss** no Bottom Sheet de detalhes.
  - **Aceite:** `public/index.html` contém o motor de física `appleRubberBand`, solver de mola `springToTab` e indicador deslizante sincronizado sem erros de sintaxe JS.

- [x] [LEAD] **T3 — Redesign Anti-Slop dos KPIs, Barra Contínua de Funil & Cards Apple Editorial (`public/index.html`)**
  - Eliminar 100% dos emojis decorativos (`🟢`, `🔴`, `🟡`, `📣`, `🎯`) de filtros, badges e chips, substituindo por pontos ópticos de `6px` e ícones vetoriais minimalistas (`stroke-width: 1.5`).
  - Reestruturar o bloco de KPIs no padrão **Apple Stocks / Linear**: tipografia limpa em branco puro (`#FFFFFF` `tabular-nums`), divisores hairline `0.5px`, highlight especular superior e **Barra Segmentada de Proporção do Funil** integrada na base + interpolação animada de números (`animateNumber`).
  - Redesenhar os cards individuais de leads com **Stepper Horizontal de 3 Estágios** (`Entrou ── Redirect ── Mensagem`), badge discreto `DEMO` para registros simulados e controles de **"Popular Exemplos"** / **"Limpar Exemplos"** em 1 toque.
  - **Aceite:** Validação estática confirma zero emojis de AI slop no HTML e presença da barra contínua de funil e stepper de 3 estágios.

- [x] [LEAD] **T4 — Suíte E2E Atualizada, Deploy na VPS & Carga Inicial dos Leads Demo em Produção**
  - Atualizar `projects/hydra-rede/src/leads_system/test_leads_system.js` testando o ciclo completo de `POST /leads/api/demo/seed` (6 cenários populados com KPIs exatos) e `POST /leads/api/demo/clear` (limpeza total preservando leads reais), além da auditoria anti-slop e do pager físico.
  - Sincronizar os arquivos atualizados para `/home/operacional/hydra-rede/src/leads_system/` na VPS, reiniciar `hydra-leads-hub` no PM2 e executar o seed inicial dos 6 leads demonstrativos no banco de produção para visualização imediata em `https://bot.tork.services/leads`.
  - **Aceite:** `node projects/hydra-rede/src/leads_system/test_leads_system.js` passa 100% e `https://bot.tork.services/leads` responde HTTP 200 com os 6 cenários de demonstração populados.
