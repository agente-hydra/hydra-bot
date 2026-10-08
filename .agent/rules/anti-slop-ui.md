# Anti-Slop UI & Web Interface Guidelines — Padrão Obrigatório de Landing Pages

> Baseado nos princípios do **Impeccable** (`impeccable.style`), nas **Web Interface Guidelines** de Rauno Freiberg (`interfaces.rauno.me`) e no ecossistema de componentes modernos.

---

## 1. Proibições Absolutas de "AI Slop" (Anti-Patterns Clichês)

Toda IA tende a gerar a mesma interface sem imaginação se não for restringida. É **estritamente proibido**:
1. ❌ **O Gradiente Clichê no Título:** Jamais usar `text-transparent bg-clip-text bg-gradient-to-r from-purple-... to-pink-...` em uma única palavra do H1 sobre fundo escuro.
2. ❌ **O Grid dos 3 Cards Flutuantes:** Jamais criar uma seção de features composta exclusivamente por 3 cards com bordas semi-transparentes (`border-white/10`), fundo `bg-white/5` ou `backdrop-blur-md` e um ícone Lucide centralizado em cada um.
3. ❌ **Dark Mode Sem Superfícies:** Jamais usar `#000000` puro chapado em toda a tela sem camadas de elevação (zinc-900, zinc-800, reflexos de iluminação volumétrica, bordas de 1px com degradê sutil).
4. ❌ **Botões Genéricos Sem Estado Tátil:** Jamais criar botões que não possuam estados claros de `:hover`, `:active` (micro-escala `scale-[0.98]`), e `:focus-visible` acessível.
5. ❌ **Placeholders e Textos Falsos:** NUNCA usar "Lorem Ipsum", "Título Incrível", "Subtítulo atraente". Todo copy deve ser focado no produto real, com proposição de valor assertiva e números concretos.

---

## 2. Princípios de Craft & Interface (Rauno Guidelines)

- **Feedback Tátil:** Toda ação do usuário precisa de resposta imediata. Botões e cartões interativos devem responder ao clique com compressão sutil (`active:scale-[0.98]` ou Framer Motion `whileTap={{ scale: 0.98 }}`).
- **Física de Molas (Spring Dynamics):** Animações devem usar curvas naturais. Evitar `transition-all duration-300 ease-linear`. Preferir curvas de mola ou `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Ritmo Tipográfico e Escala:** Títulos devem ser legíveis, com tracking negativo sutil em tamanhos grandes (`tracking-tight` ou `tracking-tighter`). O corpo de texto deve ter entrelinha confortável (`leading-relaxed`).
- **Contraste Intencional & Legibilidade:** Toda sobreposição de texto em cima de vídeo ou imagem deve conter gradiente ou máscara de legibilidade (`bg-gradient-to-b from-black/60 via-black/20 to-black/80`), preservando contraste WCAG AA no texto sem ofuscar o asset visual.

---

## 3. Ecossistema de Componentes & Referências

Antes de codificar blocos do zero ou aceitar templates padrão:
- **Buscador de Componentes shadcn:** Consultar **Shoogle** (`shoogle.dev`) para encontrar blocos prontos e integrados com shadcn/ui.
- **Micro-interações & Efeitos Avançados:** Utilizar padrões de **21st.dev** e **Aceternity UI** (`ui.aceternity.com`) para efeitos de scroll, background beams, text reveals e borders dinâmicos.
- **Scaffolding e Wireframes:** Referências de **Subframe** (`subframe.com`) e **Google Stitch** (`stitch.withgoogle.com`).
- **Benchmark Visual:** **dark.design** (referência de interfaces escuras premium), **Mobbin** (`mobbin.com` para fluxos reais de UX) e **Dribbble**.
- **MCP de Referência:** Quando disponível, consultar referências reais via **Lazyweb** (`lazyweb.com`).

---

## 4. Ciclo de Polimento (Impeccable Workflow)

Toda Landing Page desenvolvida deve passar pelas fases:
1. **Typeset:** Ajustar tipografia, contrastes de cor, hierarquia dos pesos e espaçamento vertical.
2. **Adapt:** Garantir responsividade fluida (mobile-first, tablet e ultra-wide).
3. **Harden:** Blindar a interface contra textos longos, telas pequenas, viewport reduzido e preferência de movimento reduzido (`prefers-reduced-motion`).
4. **Polish:** Refinar os detalhes de 1px (borders sutis, cantos arredondados consistentes, sombras direcionais e iluminação ambiental).
