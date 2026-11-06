# Proposta — Spec 077: Header em Ilha Flutuante Apple iOS com Física Elástica e Otimização Mobile

## Problema
O cabeçalho atual do `/leads` utiliza um modelo clássico de barra fixa retangular colada no topo (`<header class="frosted hairline-b ... w-full">`). No celular (mobile viewport 375px–414px):
1. **Espremimento visual:** Título, badge `HUB`, botão de atualizar, menu dropdown de exemplos e botão de bloqueio ficam comprimidos horizontalmente na barra de 13px, competindo com a safe-area do iOS (notch/dynamic island).
2. **Ausência de fluidez Apple:** Falta a elegância e física característica dos designs iOS modernos (como a Dynamic Island e Floating Navbars do iOS 18/macOS Sequoia), onde o elemento flutua como uma ilha com cantos generosamente arredondados, borda especular e micro-interações táteis elásticas.
3. **Dropdown rígido:** O menu de exemplos abre como um popover retangular rígido desconectado da barra, sem a transição de expansão fluida da ilha.

## Solução Proposta
Refatorar o header do `/leads` para o padrão **Apple Floating Island Header (`#floatingIslandHeader`)**:
1. **Design em Ilha Flutuante Translúcida:**
   - Container flutuante destacado do topo (`top-3.5 mx-3 sm:mx-auto max-w-4xl`), com raio de borda amplo (`rounded-full sm:rounded-[22px]`), fundo `bg-[#121215]/85` com blur vítreo ultra-fino (`backdrop-blur-2xl`), borda especular sutil (`hairline-border` com `border-white/[0.12]`) e sombra de elevação profunda (`shadow-[0_12px_40px_rgba(0,0,0,0.7)]`).
2. **Layout Mobile-First Sem Espremimento:**
   - Lado esquerdo: Monograma / Status pill com pulso verde esmeralda dinâmico + Título "Hydra Leads" em tipografia SF Pro calibrada.
   - Lado direito: Grupo de ações compactas em botões circulares/pílula com gap otimizado para o toque do polegar (touch target mínimo 38px com padding tátil).
3. **Animações e Física de Mola Apple (Spring Physics):**
   - Transição de entrada suave (`island-in` com easing cúbico `cubic-bezier(0.16, 1, 0.3, 1)`).
   - Rotação com amortecimento elástico no botão Atualizar (`#btnSyncNow`).
   - Expansão dinâmica do menu de exemplos como extensão fluida da própria ilha flutuante (`#demoDropdown`).
4. **Padding & Viewport Breathing Room:**
   - Ajuste dos espaçamentos de topo das 4 abas do carrossel (`pt-20 pb-28`) para que o conteúdo role elegantemente por trás da ilha translúcida sem cortar títulos ou KPIs.

## Especialistas Envolvidos
- **Líder (Planejamento Solo):** Roster match `k = 0` (roster-gap registrado para UI/UX Motion Frontend). Líder assume especificação, governança e execução.

## Riscos e Mitigações
- **Risco 1: Conflito com Safe-Area de Notches do iPhone (`env(safe-area-inset-top)`).**
  - *Mitigação:* Utilizar `top-[calc(env(safe-area-inset-top,0px)+0.75rem)]` garantindo que a ilha nunca invada o recorte da câmera em nenhum iPhone (iPhone X ao 16 Pro Max).
- **Risco 2: Conteúdo das abas sobrepor a ilha no scroll.**
  - *Mitigação:* `z-30` elevado no header flutuante com `pointer-events-auto` e ajuste do padding-top de todos os slides para `pt-20`.
- **Risco 3: Quebra de seletores existentes no JS (`btnSyncNow`, `btnDemoMenu`, `btnLock`, `btnSeedDemo`, `btnClearDemo`).**
  - *Mitigação:* Preservar 100% dos IDs e listeners já existentes no motor JavaScript.
