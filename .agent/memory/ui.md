# UI Memory — Diretrizes de Design, Ecossistema & Assets Visuais
> Atualizado em: 2026-09-14.
> Contém: Anti-slop UI, catálogos de componentes, pipeline de assets Nano Banana Pro + Veo 3 / Higgsfield e regras de interface.

---

## [2026-09-14] — Padrões de Landing Page Anti-Slop & Impeccable
**Contexto:** Absorção do catálogo anti-slop do Impeccable, Web Interface Guidelines de Rauno Freiberg e ferramentas de referência para LPs.
**Regra aprendida:**
- Não permitir a tríade de AI slop: título escuro com palavra em gradiente violeta/rosa neon + grid de 3 cards idênticos com borda translúcida e ícone genérico.
- Toda interface escura de alto padrão utiliza hierarquia de superfícies (ex: `zinc-950` background, `zinc-900` containers, `zinc-800` borders de 1px com degradê sutil e reflexos de luz volumétrica).
- Micro-interações táteis: botões com `active:scale-[0.98]` e curvas de mola naturais em transições.
- Máscaras de legibilidade para Hero com vídeo: gradientes verticais ou radiais calculados para garantir contraste WCAG sem matar o asset.

**Não fazer:**
- Não usar `text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-pink-500` como assinatura de design.
- Não inventar blocos do zero quando existem padrões de qualidade em `shoogle.dev` e `21st.dev`.

---

## [2026-09-14] — Catálogo de Recursos e Referências
- **Componentes shadcn:** Shoogle (`https://shoogle.dev`) — buscador direto de blocos shadcn prontos para colar.
- **Efeitos e Interações:** 21st.dev (`https://21st.dev`) e Aceternity UI (`https://ui.aceternity.com`).
- **Scaffolding e Wireframes:** Subframe (`https://subframe.com`) e Google Stitch (`https://stitch.withgoogle.com`).
- **Dark Design & Benchmarking:** dark.design (`https://dark.design`), Mobbin (`https://mobbin.com`) e Dribbble (`https://dribbble.com`).
- **MCP de Referência:** Lazyweb (`https://www.lazyweb.com`).
- **Regras de Interface:** Web Interface Guidelines (`https://interfaces.rauno.me`).

---

## [2026-09-14] — Pipeline de Assets Visuais (Modo Diretor)
**Pipeline Principal (Google Flow — Nano Banana Pro + Veo 3):**
- O Antigravity gera o **Prompt Pack** de alta precisão.
- **Nano Banana Pro (Imagem):** Foco em lentes (ex: 35mm / 85mm f/1.8), iluminação cinematográfica volumétrica, renderização fidedigna de materiais (vidro, titânio, tecidos) e tipografia nítida. Proporção 16:9. Usado como Key Visual e poster de vídeo.
- **Veo 3 (Vídeo):** Foco em movimento sutil de câmera (slow dolly-in, orbit 15°), partículas de ambiente em suspensão, iluminação em varredura suave e instrução de loop contínuo. 24fps. Usado como background do Hero.
- O usuário executa no seu Flow e deposita os arquivos em `public/assets/`.

**Pipeline Secundário (Higgsfield):**
- 100 créditos grátis para iterações rápidas ou uso direto via CLI/MCP quando aplicável.

---

## [2026-09-23] — [Feature ID: 26]
**Contexto:** Restauração das montanhas e tipografia do Hero, ciclo de vida e renderização de Core Features (WebGL + SVGs), contenção do card CTA e substituição estrutural do Footer Framer legado por Footer semântico INFYNIX.
**Regra aprendida:**
1. **XML Parsing em SVGs:** Caracteres `&` puros dentro de elementos `<text>` de arquivos SVG quebram o parser XML do navegador com erro silencioso (HTTP 200 retornado, mas o browser descarta a renderização, gerando dimensões 0x0 ou tela preta). Sempre escapar entidades XML (`&` -> `&amp;`) e validar conformidade W3C via parser estrito.
2. **Posicionamento em Palco Flex/Absolute Framer:** Em palcos com aspect ratio fixo (ex: 1080x607), elementos SVG ou imagens nunca devem usar `position: relative !important`, pois quebram o cálculo de dimensões flex e colapsam para 0x0. Usar `position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; z-index: 1 !important;`.
3. **Contraste de Cores em Bundles Minificados:** Regras CSS globais que injetam `-webkit-text-fill-color: #ffffff !important` sobrepõem qualquer `color: #000000`, gerando texto branco invisível sobre botões ou badges brancos. Sempre aplicar preenchimento direcionado com `-webkit-text-fill-color` e `--framer-text-color` sincronizados.
4. **Ciclo de Vida de Canvas WebGL:** Em SPAs com re-renderização por abas, isolar o canvas em controller de instância idempotente com `destroy()` prévio, e monitorar o DOM via `MutationObserver` e `ResizeObserver` para sincronizar dimensões físicas de buffer (`canvas.width = rect.width * dpr`) e uniforms GLSL.
5. **Purga de Footer Legado:** Ocultar elementos via CSS (`display: none`) deixa rastros residuais no DOM e no SSR. A substituição definitiva exige injeção de markup semântico tanto no SSR do `index.html` quanto na árvore de componentes do bundle (`script_main.mjs`).
**Risco identificado:** Regressão de dimensões caso novas regras utilitárias de layout sobrescrevam `position: absolute` nos filhos do container `#features`.
**Não fazer:** Nunca usar `&` literal em arquivos SVG/XML; nunca sobrescrever `position: absolute` de camadas de sobreposição com `position: relative`; nunca usar `display: none` cosmético quando a remoção estrutural for exigida.

---

## [2026-09-23] — [Feature ID: 27]
**Contexto:** Adaptação da seção `#what-you-get` para a narrativa "Como trabalhamos" da INFYNIX (Descoberta, Implementação e Evolução) com reconstrução de cenários WebP limpos e sobreposição de 4 mockups SVG transparentes.
**Regra aprendida:**
1. **Composição Fundo vs. Interface em Framer:** Quando o template original funde imagem de paisagem e UI em um único asset WebP, a abordagem limpa e não-destrutiva consiste em reconstruir o cenário de relevo/atmosfera sem UI (em WebP 1064x1224) e aplicá-lo como `background-image` CSS no wrapper nativo (`.framer-1aovpg7`, `.framer-1m0pk4b`, `.framer-yxhp5q`), enquanto a tag `<img>` interna carrega um SVG transparente com o diagrama de interface. Isso preserva 100% dos efeitos sticky, transformações e triggers nativos do Framer.
2. **Substituição de Bundles sem Romper Overrides Responsivos:** No Framer, propriedades de imagem (`src`, `srcSet`, `alt`) costumam ser repetidas em objetos de breakpoint (`khqiCc40I` para tablet, `ZKmmBcMXU` para mobile e valor padrão para desktop). É mandatório substituir todas as ocorrências de forma consistente para evitar que um breakpoint caia de volta no asset legado.
3. **Validação Estrita de SVGs com Textos:** Todo caractere `&` em strings de texto SVG deve ser rigorosamente codificado como `&amp;` e validado via parser XML W3C.
**Risco identificado:** Alterações de padding ou margem nos cards sticky podem desalinhar a sincronização dos triggers `#trig-1`, `#trig-2`, `#trig-3`.
**Não fazer:** Nunca substituir paisagens complexas por fundos lisos ou JPGs genéricos que contenham outras UIs embutidas; nunca usar `background: transparent !important` em wrappers que dependem de imagem de fundo composta.




---

## [2026-10-07] — [Feature: Layout Hermes WhatsApp — Separação de Cards de OS e Eliminação de Pipes]
**Contexto:** Formatação de listagens operacionais e de múltiplas Ordens de Serviço (OSs) no WhatsApp via Hydra Bot.
**Regra aprendida:**
1. **Preservação de Divisores de Traços no WhatsApp:** Linhas de separação visual como `----------------------------------------` não são `<hr>` do HTML, mas separadores de texto cru essenciais para a legibilidade mobile no WhatsApp. O sanitizador de markdown nunca deve purgar linhas com 6 ou mais traços repetidos (`-{6,}`).
2. **Cabeçalhos de Cards com Blockquote (`>`):** No padrão Hermes executivo do WhatsApp, todo card individual de OS ou unidade deve iniciar obrigatoriamente com o marcador blockquote nativo: `> *OS #XXXX — MODELO (PLACA)*` ou `> *NOME DA LOJA (X veículos)*`. Isso cria a barra vertical lateral azul/cinza do WhatsApp, destacando o item.
3. **Proibição Estrita de Pipes Inline (`|`):** Nunca agrupar atributos (`Carro | OS | Valor | Status`) em uma única linha horizontal no WhatsApp. Isso cria "amebas indecifráveis" na tela estreita dos smartphones. Cada campo deve residir em sua própria linha ou bullet vertical (`- *Status:* Em Execução • *Pátio:* 6 dias`).
4. **Pós-Processador Sanitizador Determinístico:** Modelos LLM podem ocasionalmente reintroduzir pipes inline mesmo sob system prompt rigoroso. A função `reformatPipedLinesToHermesCards` atua como guardrail determinístico convertendo automaticamente qualquer linha com pipes em cards verticais estruturados.
**Não fazer:** Nunca agrupar campos com `|`; nunca remover separadores `----------------------------------------` no regex de markdown; nunca permitir múltiplos carros em uma mesma linha.

---

## [2026-11-05] — [Feature: 074-leads-hub-apple-swipe-anti-slop-demo]
**Contexto:** Evolução do Hub `/leads` (`projects/hydra-rede/src/leads_system/public/index.html`) com navegação por gesto de arraste horizontal 1:1 nível Apple iOS, redesign anti-slop de KPIs (padrão Apple Stocks / Linear) e carga demonstrativa idempotente dos 6 estados do funil.
**Regra aprendida:**
1. **Swipe Horizontal 1:1 sem Conflito com Scroll Vertical:** Em webapps mobile-first, o pager horizontal GPU-composited (`translate3d`) deve aplicar **Direction Lock** nos primeiros `8px` de movimento (`|dx| > |dy| * 1.22`), liberando imediatamente o scroll vertical nativo da lista caso o eixo dominante seja Y, e aplicando resistência hiperbólica estilo `UIScrollView` (`appleRubberBand`, `c = 0.55`) nas abas extremas.
2. **Continuidade de Velocidade na Mola (`springToTab`):** Ao soltar o dedo, o solver harmônico amortecido (`stiffness: 380, damping: 36, mass: 0.9`) deve herdar a velocidade instantânea do gesto (`vx` em `px/ms`) e sincronizar 1:1 no mesmo `requestAnimationFrame` a **Liquid Sliding Pill** da barra inferior.
3. **Telemetria Anti-Slop (Apple Stocks / Linear):** Substituir cards coloridos separados e emojis decorativos (`🟢`, `🔴`, `🟡`, `📣`, `🎯`) por um container único `.telemetry-shell` (`#111113`, divisores hairline `0.5px`, números em `#FFFFFF` `tabular-nums`, barra contínua de proporção do funil na base e **Stepper Horizontal de 3 Estágios** nos cards).
4. **Blindagem de Registros Demo (`demo_`):** Sempre isolar dados demonstrativos por prefixo determinístico (`visit_id LIKE 'demo_%'`) e excluí-los de rotinas automáticas de expiração (`sweepExpiredSessions`) para preservar estados vivos (`ENTROU`, `REDIRECIONADO`) até limpeza explícita em 1 toque (`POST /leads/api/demo/clear`).
**Não fazer:** Nunca usar emojis como substitutos de indicadores ópticos/vetoriais em dashboards executivos; nunca trocar abas via `display: none` seco quando houver barra de navegação mobile arrastável; nunca deixar registros de demonstração sem rota dedicada de expurgo cirúrgico.

---

## [2026-11-05] — [Feature: 075-leads-central-lista-paginada-cruzamento-os]
**Contexto:** Implementação da visualização em Lista Paginada (Tabela Densa com paginação 10/20/50/100), seletor de visualização Lista vs Grade com persistência em `localStorage`, linhas de tabela clicáveis sem necessidade de botão explícito, filtro por intervalo de datas ("de X a Y" com presets Hoje, 7d, 30d, Tudo) e 4ª aba "Análise" com rankings visuais de campanhas e detalhes de OSs vinculadas no modal do lead.
**Regra aprendida:**
1. **Transição de Física de Gestos para 4 Abas:**
   - Ao expandir o pager para 4 abas (`TAB_COUNT = 4`), a largura do container de trilho (`#pagerTrack`) deve ser `400%`, com cada seção ocupando `w-1/4` (25%).
   - A grade inferior de navegação muda para `grid-cols-4`, e a pílula líquida deslizante (`#liquidPill`) passa a calcular a largura via `w-[calc((100%-8px)/4)]` com translação dinâmica `x = index * ((rect.width - 8) / 4)`.
2. **Tabela Densa Mobile-First com Linhas Clicáveis:**
   - Em tabelas densas, clicar diretamente na linha (`tr[data-visit-id]`) melhora a velocidade de auditoria sem poluir a interface com botões repetitivos "Ver Detalhes".
   - Aplicar `:active` e hover com feedback visual tátil (`bg-neutral-800/60`), mantendo links internos (`a[href^="tel:"]` ou `a[href^="https://wa.me"]`) com `event.stopPropagation()` para não disparar abertura acidental da modal ao clicar para ligar/conversar.
3. **Persistência de Preferência de View (Lista vs Grade):**
   - Armazenar o modo de visualização preferido em `localStorage.getItem('tork_leads_view_mode')` (`'list'` ou `'grid'`), alternando classes `hidden` nos containers `#leadsTableView` e `#leadsGridView` e destacando o botão ativo no toggle segmentado.
4. **Rankings de Campanhas com Barras de Faturamento Proporcionais:**
   - Na aba de Análise, exibir barras de progresso horizontais proporcionais (`width: (receita_campanha / receita_maxima) * 100%`) em tom esmeralda/verde sutil para fornecer contraste imediato de quais campanhas estão gerando mais faturamento em OSs fechadas.
**Não fazer:**
- NUNCA colocar botões de ação redundantes ("Abrir", "Detalhes") ocupando colunas inteiras quando a linha inteira pode ser a área de toque.
- NUNCA esquecer de parar a propagação do clique (`stopPropagation`) em links de discador e WhatsApp dentro de linhas clicáveis.
