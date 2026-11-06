# Design de Arquitetura — Spec 077: Header em Ilha Flutuante Apple iOS com Física Elástica

## 1. Arquitetura Visual & Componentes

### 1.1 Ilha Flutuante (`#floatingIslandHeader`)
Substitui o `<header>` retangular fixo por uma ilha flutuante livre desacoplada das bordas da tela:

```html
<!-- HEADER EM ILHA FLUTUANTE ESTILO APPLE DYNAMIC ISLAND -->
<header id="floatingIslandHeader"
        class="fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-3 right-3 sm:left-auto sm:right-auto sm:w-full sm:max-w-4xl sm:mx-auto z-30 pointer-events-none"
        data-no-swipe="true">
  <div class="pointer-events-auto h-12 sm:h-13 px-3.5 sm:px-5 rounded-full bg-[#121215]/85 backdrop-blur-2xl border border-white/[0.12] shadow-[0_12px_40px_rgba(0,0,0,0.65)] flex items-center justify-between transition-all duration-300">
    
    <!-- Lado Esquerdo: Marca & Live Status -->
    <div class="flex items-center space-x-2.5">
      <div class="relative flex items-center justify-center">
        <span class="w-2.5 h-2.5 rounded-full bg-iosGreen shadow-[0_0_10px_rgba(48,209,88,0.8)] animate-pulse"></span>
        <span class="absolute w-4 h-4 rounded-full bg-iosGreen/20 animate-ping"></span>
      </div>
      <div class="flex items-center space-x-1.5">
        <span class="font-semibold tracking-tight text-white text-[14px] sm:text-[15px]">Hydra Leads</span>
        <span class="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-white/[0.08] text-zinc-300 font-medium border border-white/[0.08]">HUB</span>
      </div>
    </div>

    <!-- Lado Direito: Ações Compactas Rápidas -->
    <div class="flex items-center space-x-1.5 sm:space-x-2">
      <!-- Botão Sincronizar com Spin Spring -->
      <button id="btnSyncNow"
              class="spring-tap h-8 px-2.5 sm:px-3 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] text-xs text-zinc-200 flex items-center gap-1.5 transition">
        <svg id="syncIcon" class="w-3.5 h-3.5 text-zinc-300 transition-transform duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
        </svg>
        <span class="hidden md:inline font-medium text-[11px]">Atualizar</span>
      </button>

      <!-- Menu Exemplos em Pílula -->
      <div class="relative inline-block text-left">
        <button id="btnDemoMenu"
                class="spring-tap h-8 px-2.5 sm:px-3 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] text-xs text-zinc-300 flex items-center gap-1 transition">
          <span class="text-[11px] font-medium">Exemplos</span>
          <svg class="w-3 h-3 text-iosGray" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <div id="demoDropdown" class="hidden absolute right-0 mt-2 w-48 rounded-2xl bg-[#18181C]/95 backdrop-blur-xl border border-white/[0.12] shadow-2xl p-1.5 z-50 text-xs transform origin-top-right transition-all">
          <button id="btnSeedDemo" class="w-full text-left px-3 py-2 rounded-xl hover:bg-white/[0.08] text-white flex items-center justify-between">
            <span>Popular 6 exemplos</span>
            <span class="text-[10px] text-iosBlue font-mono">+6</span>
          </button>
          <button id="btnClearDemo" class="w-full text-left px-3 py-2 rounded-xl hover:bg-red-500/10 text-iosRed flex items-center justify-between">
            <span>Limpar exemplos</span>
            <span class="text-[10px] text-iosRed font-mono">del</span>
          </button>
        </div>
      </div>

      <!-- Botão Lock / Sair Circular -->
      <button id="btnLock"
              class="spring-tap w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center justify-center text-iosGray hover:text-white transition"
              title="Bloquear painel">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/>
        </svg>
      </button>
    </div>

  </div>
</header>
```

### 1.2 Ajuste dos Viewports das 4 Abas
O carrossel com swipe horizontal contém 4 abas:
- `#tabLeads`: de `pt-4 pb-28` &rarr; `pt-20 pb-28`
- `#tabAnalytics`: de `pt-4 pb-28` &rarr; `pt-20 pb-28`
- `#tabAds`: de `pt-4 pb-28` &rarr; `pt-20 pb-28`
- `#tabWebhook`: de `pt-4 pb-28` &rarr; `pt-20 pb-28`

Isso garante que ao rolar o conteúdo para o topo, os primeiros elementos (como os KPIs de faturamento e filtros) comecem com respiro natural abaixo da ilha flutuante.

### 1.3 CSS & Animações Apple
```css
@keyframes islandIn {
  from {
    opacity: 0;
    transform: translate3d(0, -18px, 0) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

#floatingIslandHeader > div {
  animation: islandIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Rotação com amortecimento elástico no ícone de atualização */
.sync-spin {
  animation: spinSmooth 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes spinSmooth {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

## 2. Arquivos Afetados
- `projects/hydra-rede/src/leads_system/public/index.html` (Markup da ilha, animações CSS e padding das seções).
- `projects/hydra-rede/src/leads_system/test_leads_system.js` (Asserções dos elementos `#floatingIslandHeader`, `#btnSyncNow`, `#btnDemoMenu`, `#btnLock`).
