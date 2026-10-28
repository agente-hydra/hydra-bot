# Design Técnico — Spec 045: Neutralização Ativa de Joyride Tour / Backdrops e Resiliência de Sessão

## 1. Arquitetura da Neutralização em Camadas (Defense-in-Depth)

Para garantir que o Joyride Tour ou qualquer overlay não consiga interceptar cliques do Playwright sob nenhuma condição de temporização, a neutralização atua em **3 camadas concorrentes**:

```
[NAVEGAÇÃO DA PÁGINA (page.goto)]
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│ CAMADA 1: Supressão por CSS (page.addStyleTag)           │
│                                                          │
│ Injeta regra no documento raiz:                          │
│ .backdrop-container, .joyride-backdrop,                  │
│ [id*="backdrop"] {                                       │
│   pointer-events: none !important;                       │
│   display: none !important;                              │
│ }                                                        │
│ -> Elimina fisicamente a captura de eventos de ponteiro  │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ CAMADA 2: Expurgador de DOM no expectToPass              │
│                                                          │
│ A cada iteração antes do clique:                         │
│ 1. Varre e remove (.remove()) elementos de tour          │
│ 2. Clica preventivamente em "Pular", "Fechar", .close    │
│ 3. Restaura document.body.style.overflow = 'auto'        │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ CAMADA 3: Guarda de Visibilidade do Modal de Lojas       │
│                                                          │
│ Se o modal (.modalchangebrand) já estiver aberto:        │
│   -> NÃO clica no cabeçalho (evita erro de sobreposição) │
│ Se estiver fechado:                                      │
│   -> Clica no seletor de lojas para abrir                │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Interfaces TypeScript e Tipagens

```typescript
// Contratos de Controle de Overlays e Sessão

export interface OverlayCleanupResult {
  removedBackdropsCount: number;
  closedModalsCount: number;
  skippedTour: boolean;
  bodyOverflowRestored: boolean;
}

export interface EstabelecimentoSelectionOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  skipHeaderClickIfModalOpen?: boolean;
}

export interface SessionVerificationResult {
  isAuthenticated: boolean;
  activeUrl: string;
  cookiesCount: number;
  needsCaptchaResolution: boolean;
}
```

---

## 3. Especificação Detalhada das Modificações (`src/scraper.js`)

### 3.1. Injeção de CSS Anti-Backdrop (`injetarEstilosAntiOverlay`)
Executado após carregar qualquer página ou no setup do contexto:
```javascript
async function injetarEstilosAntiOverlay(page) {
  try {
    await page.addStyleTag({
      content: `
        .joyride-backdrop,
        .backdrop-container,
        [id*="backdrop-composite"],
        [class*="joyride-backdrop"],
        .joyride-step__holder {
          display: none !important;
          pointer-events: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          z-index: -9999 !important;
        }
      `
    });
  } catch (_) {}
}
```

### 3.2. Função `limparOverlays(page)` Endurecida
```javascript
async function limparOverlays(page) {
  try {
    // 1. Tenta clicar no botão de pular/fechar tour se presente
    const skipSelectors = [
      'button:has-text("Pular")',
      'button:has-text("Fechar")',
      'button:has-text("Começar a usar")',
      'button:has-text("Entendi")',
      '.joyride-tooltip__close',
      '[aria-label="Fechar tour"]'
    ];
    for (const sel of skipSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
      }
    }

    // 2. Remoção cirúrgica de nós no DOM
    await page.evaluate(() => {
      const sels = [
        '.joyride-backdrop', '.backdrop-container', '[id*="backdrop"]',
        '.joyride-step__holder', '.joyride-step__container', '.joyride-step',
        '.tooltip', '.popover', '[class*="tooltip"]', '[class*="popover"]', '[class*="coachmark"]'
      ];
      sels.forEach(s => {
        document.querySelectorAll(s).forEach(el => {
          // Garante que não remove o modal legítimo de estabelecimentos
          if (!el.closest('.modalchangebrand, [id*="change-side"], [id*="pv-lightbox-change-side"]')) {
            el.remove();
          }
        });
      });
      document.body.style.overflow = 'auto';

      // Fechar modal genérico se não for o seletor de lojas
      const btns = Array.from(document.querySelectorAll('button, [aria-label="Fechar"], .close, a'));
      for (const b of btns) {
        if (b.closest('.modal, [class*="modal"], [class*="dialog"]') && !b.closest('.modalchangebrand, [id*="change-side"], [id*="pv-lightbox-change-side"]')) {
          b.click();
        }
      }
    });

    // 3. Aplica regra CSS anti-pointer-events
    await injetarEstilosAntiOverlay(page);
  } catch (_) {}
}
```

### 3.3. Guarda no `selecionarEstabelecimento(page, loja)`
Atualizar o loop `expectToPass` para:
1. Executar `limparOverlays(page)` no início de cada tentativa do loop.
2. Checar se o modal de estabelecimentos (`.modalchangebrand`, `.modal-default`, `#pv-lightbox-change-side-header-bar`, etc.) já está visível antes de tentar clicar no botão do cabeçalho.
3. Se estiver visível, prossegue direto para a seleção do radio button do EC.
4. Se estiver fechado, clica no cabeçalho com tolerância a backdrop.

---

## 4. Testabilidade e Verificação

1. **Teste Automatizado de Overlays:**
   - Adicionar caso de teste simulando injeção de `<div class="backdrop-container" id="backdrop-composite_step1_home"><div class="joyride-backdrop"></div></div>` no DOM e validar que o `limparOverlays` remove a camada e permite o clique sem bloqueio.
2. **Execução E2E em Produção:**
   - Validar a passagem limpa da seleção de lojas de 1 a 10 no portal real.
