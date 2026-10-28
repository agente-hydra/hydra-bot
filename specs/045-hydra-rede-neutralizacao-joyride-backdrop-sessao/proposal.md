# Proposta de Arquitetura — Spec 045: Neutralização Ativa de Joyride Tour / Backdrops e Resiliência de Sessão no Hydra Rede

## 1. Causa Raiz do Erro no Playwright

O erro não foi no código da Spec, mas sim na interface do portal da Rede. O portal exibiu um tutorial guiado / modal de boas-vindas (Joyride Tour) que criou uma camada sobreposta na tela inteira (`<div class="joyride-backdrop">`), bloqueando e interceptando todos os cliques do Playwright:
```text
<div class="joyride-backdrop backdrop-top"></div> from <div class="backdrop-container" id="backdrop-composite_step1_home"> intercepts pointer events
```

### Detalhamento da Interceptação:
1. **Injeção Assíncrona do Joyride (Angular Tour):**
   - Ao carregar a página inicial (`/home`), o portal injeta assincronamente um tour guiado de boas-vindas / coachmarks (`#backdrop-composite_step1_home`, `.joyride-backdrop`, `.joyride-step`).
   - A rotina legada `limparOverlays(page)` era executada imediatamente após `domcontentloaded`, momento em que os elementos do Joyride ainda não haviam sido renderizados.
   - Segundos depois, a camada do Joyride surgia cobrindo 100% da viewport com `position: fixed` e `z-index: 999999`, interceptando todos os eventos de ponteiro (`pointer events`) disparados pelo Playwright em `c-header__wrapper-establishment` ou nos radio buttons.

---

## 2. Como Corrigir Imediatamente

### 2.1. Neutralizar o Modal / Backdrop do Joyride no Código
Antes de clicar no seletor de lojas, adicionar uma rotina para fechar ou remover a camada de tour da página:

```javascript
// 1. Remove qualquer modal de tutorial/backdrop que esteja cobrindo a tela
await page.evaluate(() => {
  const backdrops = document.querySelectorAll('.backdrop-container, .joyride-backdrop, .joyride-step, [id*="backdrop"]');
  backdrops.forEach(el => el.remove());
  document.body.style.overflow = 'auto';
});

// 2. Ou tenta clicar no botão de fechar/pular do tour se existir
const skipTourBtn = page.locator('button:has-text("Pular"), button:has-text("Fechar"), .joyride-tooltip__close').first();
if (await skipTourBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await skipTourBtn.click().catch(() => {});
}
```

Além disso, reforçar com:
- **Injeção de CSS Anti-Backdrop (`page.addStyleTag`):**
  ```css
  .backdrop-container, .joyride-backdrop, [id*="backdrop-composite"] {
    display: none !important;
    pointer-events: none !important;
    visibility: hidden !important;
  }
  ```
- **Guarda de Modal Pré-Aberto no `selecionarEstabelecimento`:**
  Se o modal de lojas (`.modalchangebrand`, `#pv-lightbox-change-side-header-bar`) já estiver aberto, não clicar novamente no botão do cabeçalho para evitar falsos conflitos de sobreposição.

### 2.2. Resolver o Captcha / Sessão Expirada
O aparecimento de Captcha ocorre quando a adquirente detecta múltiplos logins seguidos ou requisições repetidas após falhas consecutivas:

1. **Abrir o navegador em modo interativo/visível (`headless: false`)** ou através da ponte web remota (`https://bot.tork.services/rede-auth`).
2. **Fazer o login manualmente e resolver o Captcha uma única vez.**
3. **Salvar o arquivo de sessão renovado (`storageState_rede.json`).**
4. **Executar novamente a automação com a sessão válida salva.**

---

## 3. Contratos de Dados e Mudanças de Interface

Nenhum contrato externo com clientes ou com a Evolution API é modificado. O comportamento interno do `scraper.js` é fortalecido:
- `limparOverlays(page)`: passa a remover ativamente os seletores `.backdrop-container, .joyride-backdrop, .joyride-step, [id*="backdrop"]` e acionar botões de pular/fechar.
- `selecionarEstabelecimento(page, loja)`: incorpora a limpeza ativa dentro de cada iteração de tentativa de clique e checa se o modal já está visível antes de clicar no cabeçalho.
- `injetarEstilosAntiOverlay(page)`: adiciona regras CSS que suprimem pointer-events do Joyride.

---

## 4. Riscos Principais e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Remoção acidental de modais legítimos (ex: modal de troca de loja) | Alto | Exclusão explícita na remoção: seletores nunca tocam em classes que contenham `modalchangebrand`, `pv-lightbox` ou `modal-stores-list`. |
| Joyride reaparecer após troca de loja ou navegação SPA | Médio | Injeção global de estilo (`addStyleTag`) suprime a visibilidade e pointer-events do backdrop por todo o ciclo de vida da página. |
| Sessão ser invalidada durante a extração das 10 lojas | Médio | O `state_manager` com Resume Inteligente preserva as lojas já baixadas com sucesso, permitindo re-autenticação rápida e retomada pontual. |

---

## 5. Critérios de Aceite (DoD)

1. A página `/home` da Rede deve permitir cliques nos seletores de estabelecimento sem qualquer erro de `intercepts pointer events`.
2. O seletor de lojas deve reconhecer se o modal já está aberto antes de tentar clicar no cabeçalho.
3. As 10 lojas devem conseguir selecionar seus respectivos estabelecimentos e navegar para o relatório de vendas.
4. Toda a suíte de testes existente (`npm run test:all`) deve continuar passando com 100% de sucesso.
