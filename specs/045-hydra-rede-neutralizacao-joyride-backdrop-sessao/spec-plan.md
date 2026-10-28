# Plano de Implementação — Spec 045: Neutralização Ativa de Joyride Tour / Backdrops e Resiliência de Sessão

## Tarefas de Implementação

- [x] [SCRAPER] Atualizar rotinas de overlay em `projects/hydra-rede/src/scraper.js`:
  - Implementar `injetarEstilosAntiOverlay(page)` com regras CSS `pointer-events: none !important; display: none !important;` para `.backdrop-container`, `.joyride-backdrop`, `[id*="backdrop-composite"]`.
  - Reforçar `limparOverlays(page)` para:
    - Clicar preventivamente em botões de dispensa de tour (`"Pular"`, `"Fechar"`, `"Começar a usar"`, `.joyride-tooltip__close`).
    - Remover compulsoriamente nós do DOM sem afetar modais de troca de loja.
    - Destravar o scroll da página (`body.style.overflow = 'auto'`).
    - Aplicar a injeção de CSS anti-backdrop.

- [x] [SELETOR] Atualizar `selecionarEstabelecimento(page, loja)` em `projects/hydra-rede/src/scraper.js`:
  - Incorporar `await limparOverlays(page)` dentro do loop de retry do `expectToPass`.
  - Adicionar checagem de visibilidade prévia do modal de estabelecimentos (`modalStores.isVisible()`) para não tentar clicar no botão do cabeçalho caso o modal já esteja aberto.

- [x] [TESTS] Validar suíte de testes existente:
  - Executar `npm run test:all` em `projects/hydra-rede` garantindo que os 6 pilares de testes continuam 100% aprovados (Aprovado em 29.61s).

- [x] [VPS] Sincronizar e validar na VPS de produção (`operacional@100.126.50.101:/home/operacional/hydra-rede/`):
  - Transferir `src/scraper.js` atualizado via SCP.
  - Executar a suíte unificada na VPS (`tests/run_all_tests.js`) garantindo 100% de aprovação (Aprovado em 28.98s).

- [x] [GATE] Conclusão do ciclo e Hard Stop.
