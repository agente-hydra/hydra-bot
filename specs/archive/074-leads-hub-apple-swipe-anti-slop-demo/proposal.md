# Spec 074 — Física de Swipe Nível Apple iOS, Redesign Anti-Slop dos KPIs & Leads Demonstrativos em `/leads`

## 1. Problema Detalhado
Após a entrega estrutural do Hub `/leads` (`https://bot.tork.services/leads`), três pontos de experiência de produto e acabamento visual precisam ser elevados ao padrão nativo Apple iOS:
1. **Troca de Abas Estática (Sem Gesto de Arraste Horizontal):** Atualmente a troca entre as abas (`Leads`, `Anúncios & Tag`, `Webhook`) ocorre por `display: none` instantâneo no clique, sem suporte a arrastar o dedo para o lado (`swipe` horizontal 1:1 com inércia física e mola estilo Framer Motion / React Spring) e sem pílula deslizante contínua na barra inferior.
2. **Estética "AI Slop" nos KPIs e Badges:** Os 4 cards de KPIs atuais utilizam números coloridos em excesso (amarelo, verde e vermelho simultâneos), ícones circulares clichês e emojis literais (`🟢`, `🔴`, `🟡`, `📣`, `🎯`) espalhados nos filtros e nos chips dos leads — quebrando a sobriedade editorial da Apple (`Apple Stocks` / `Apple Health` / `Linear`).
3. **Painel Vazio sem Amostra Real de Cada Estado:** Para validar visualmente como cada tipo de lead aparece no dia a dia antes do tráfego pago rodar em volume, é necessário popular um exemplar fiel de cada estágio do funil (`Entrou na Página`, `Redirecionado`, `Mandou Mensagem por Código`, `Mandou Mensagem por Telefone`, `Perdido sem Redirect` e `Perdido que Não Chamou no WhatsApp`), com opção limpa de remover os exemplos em 1 toque quando desejar.

---

## 2. Solução Proposta

### Pilar 1: Motor de Gesto Swipe Horizontal & Física de Mola Real (Spring Physics 60/120fps)
Inspirado na arquitetura física de **Framer Motion**, **React Spring** e **AutoAnimate**:
- **Track Horizontal GPU-Composited (`translate3d`):** As 3 páginas (`Leads`, `Anúncios & Tag`, `Webhook`) passam a residir lado a lado em um palco horizontal com captura de gesto unificada (`touch` mobile + `pointer/trackpad` desktop).
- **Rastreamento 1:1 com Directional Lock:** Ao arrastar horizontalmente (`|dx| > |dy| * 1.2`), a tela acompanha o dedo em tempo real pixel por pixel sem bloquear o scroll vertical interno de cada página.
- **Rubber-Band Nativos nas Extremidades:** Ao puxar além da 1ª ou 3ª aba, aplica a curva hiperbólica de resistência elástica da Apple (`1 - 1 / (d * 0.55 / w + 1)`).
- **Oscilador Harmônico Amortecido com Preservação de Velocidade (`vx`):** Ao soltar o dedo, o solver físico (`stiffness: 380, damping: 36, mass: 0.9`) herda a velocidade exata do flick (`px/ms`), completando a transição sem cortes secos.
- **Liquid Sliding Pill (`layoutId` na Tab Bar) & Sheet Interativo:** A barra inferior ganha um indicador translúcido que desliza sincronizado com a posição `x` do swipe, e o modal de detalhes do lead passa a suportar **drag-to-dismiss** vertical estilo iOS Sheet (com leve recuo `scale(0.97)` do fundo).

### Pilar 2: Redesign Anti-Slop dos KPIs & Cards (Padrão Apple Health / Linear)
- **Eliminação Total de Emojis Decorativos:** Remoção integral de `🟢`, `🔴`, `🟡`, `📣`, `🎯` em favor de micro-pontos ópticos (`6px`) e ícones vetoriais minimalistas (`stroke-width: 1.5`).
- **Painel de KPIs Editorial (Monochrome-First + Barra Contínua de Funil):**
  - Tipografia limpa em branco puro (`#FFFFFF`, `tracking-tight`, `tabular-nums`) sobre superfície `#121214` com luz especular superior de `1px` (`inset 0 1px 0 rgba(255,255,255,0.06)`), reservando cor semântica apenas para micro-indicadores e taxas percentuais discretas.
  - Barra horizontal segmentada integrada logo abaixo dos 4 números mostrando visualmente a proporção entre **Convertidos (Mandaram Msg)**, **Em Aguardo (Redirecionados)** e **Perdidos**.
- **Cards de Leads com Timeline Horizontal de 3 Estágios:**
  - Substituição da caixa bruta de timestamps por um **Stepper Horizontal Apple-style** (`Entrou ── Redirect ── Mensagem`) com cálculo automático de latência de conversão (ex: `16s até chamar`) e animações suaves de filtragem na lista.

### Pilar 3: Carga Demonstrativa Completa (1 Lead de Cada Caso + Limpeza em 1 Toque)
- Criação do módulo `seed_demo_leads.js` e rotas administrativas autenticadas (`POST /leads/api/demo/seed` e `POST /leads/api/demo/clear`):
  1. **Mandou Mensagem (via `Código: K7M9P2` + Google Tag `gclid`)**
  2. **Mandou Mensagem (via Telefone E.164 + Veículo informado)**
  3. **Redirecionado (Aguardando envio no WhatsApp)**
  4. **Perdido — Não Chamou no WhatsApp (`NAO_CHAMOU_WHATSAPP`)**
  5. **Perdido — Saiu da Página sem Redirecionar (`SEM_REDIRECT`)**
  6. **Na Página Agora (`ENTROU` em tempo real)**
- Todos os registros de demonstração recebem prefixo `demo_` em `visit_id`, permitindo visualização imediata no painel de produção e remoção instantânea e cirúrgica pelo botão **"Limpar Exemplos Demo"** sem afetar nenhum lead real.

---

## 3. Especialistas Envolvidos
- **Aviso de Roster-Gap (`k = 0`):** O `match_roster.mjs` retornou `mode: "solo"` (`hasRosterGap: true`) por tratar-se majoritariamente de física de animação frontend, design system anti-slop e seeding determinístico. O planejamento e a execução serão conduzidos diretamente por `[LEAD]`.

---

## 4. Riscos e Mitigação
| Risco | Impacto | Mitigação |
| :--- | :--- | :--- |
| **Conflito entre Scroll Vertical da Lista e Swipe Horizontal** | Ao rolar os leads para baixo, a página tentar mudar de aba acidentalmente | Implementar **Intent Lock nos primeiros 10px** do toque: se `|dy| >= |dx|`, trava o gesto como scroll vertical puro até o `touchend`; o swipe horizontal só engata se `|dx| > |dy| * 1.25`. |
| **Conflito de Swipe em Blocos `<pre>` de Código horizontal** | Arrastar um JSON largo na aba Webhook disparar troca de aba | Ignorar início de swipe quando `e.target.closest('pre, code, input, select, [data-no-swipe]')`. |
| **Leads de demonstração misturados a leads reais de campanhas** | Distorção futura nas métricas de tráfego pago | Identificar todo lead demo com `visit_id LIKE 'demo_%'` e disponibilizar botão **"Limpar Leads de Exemplo"** em 1 clique na interface autenticada. |
