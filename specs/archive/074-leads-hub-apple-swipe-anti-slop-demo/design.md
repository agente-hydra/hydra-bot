# Design Técnico — Spec 074: Física de Swipe Apple iOS, Redesign Anti-Slop & Leads Demo

## 1. Arquitetura de Animação & Gestos (Framer Motion / React Spring Physics)

```mermaid
flowchart LR
    subgraph "Input Layer (Mobile Touch & Pointer)"
        A["touchstart / pointerdown"] --> B{"Direction Lock (10px)\n|dx| > |dy| * 1.25?"}
        B -->|Não (Scroll Y)| C["Scroll Vertical Nativo da Aba"]
        B -->|Sim (Swipe X)| D["1:1 Finger Tracking + Rubber-Band"]
    end

    subgraph "Spring Physics Solver (rAF 60/120fps)"
        D -->|touchend / pointerup + vx| E["Damped Harmonic Spring\n(k=380, c=36, m=0.9, v0=vx)"]
        E --> F["GPU Track: translate3d(x, 0, 0)"]
        E --> G["Bottom Nav Liquid Pill: translate3d(progress * tabW, 0, 0)"]
    end
```

### 1.1. Equações do Solver de Mola (Preservação de Velocidade do Dedo)
Diferente de `CSS transition` (que zera a velocidade inicial do gesto), o motor de animação roda via `requestAnimationFrame` integrando a Lei de Hooke com amortecimento viscoso:
- **Parâmetros calibrados Apple iOS:**
  - `stiffness = 380`
  - `damping = 36`
  - `mass = 0.9`
- **Rubber-Band nas bordas (Fórmula Oficial Apple UIScrollView):**
  ```js
  function appleRubberBand(distance, dimension, constant = 0.55) {
    return (1 - (1 / ((distance * constant / dimension) + 1))) * dimension;
  }
  ```
- **Critério de Snap na Soltura:**
  - Se velocidade `|vx| > 0.35 px/ms` na direção do arraste OU deslocamento `|dx| > 0.22 * viewportWidth`, avança/recua para `targetIndex`. Caso contrário, retorna suavemente para `activeIndex` com a mola.
- **Auto-Animate de Lista & Contadores Numéricos:**
  - Interpolação fluida (`animateNumber`) nos 4 KPIs do topo ao trocar filtros de período (`Hoje`, `7d`, `30d`, `Tudo`) ou receber novos leads.
  - Entrada suave escalonada (`opacity` + `translateY(6px -> 0)`) nos cards filtrados, respeitando `prefers-reduced-motion`.
- **iOS Interactive Sheet (Modal de Detalhes):**
  - Suporte a puxar o cabeçalho do Bottom Sheet para baixo (`dy > 0`) com acompanhamento 1:1 e fechamento elástico se `dy > 90px` ou `vy > 0.45 px/ms`, enquanto o container de fundo (`#appShell`) aplica `transform: scale(0.975)` e `filter: brightness(0.85)`.

---

## 2. Sistema Visual Anti-Slop (Apple Stocks / Linear Aesthetic)

1. **Hierarquia de Superfícies & Luz Especular:**
   - Canvas base: `#000000` (OLED True Black).
   - Superfície de KPIs Unificada: Container `#111113` com divisores verticais/horizontais de `0.5px` (`rgba(255,255,255,0.08)`) e highlight superior `box-shadow: inset 0 1px 0 rgba(255,255,255,0.06)` — substituindo 4 caixas soltas com bordas pesadas e números arco-íris.
   - Barra de Proporção do Funil Integrada: Faixa horizontal de `4px` de altura na base do painel de KPIs dividida proporcionalmente entre **Mandaram Mensagem** (`#30D158`), **Aguardando pós-Redirect** (`#0A84FF`) e **Perdidos** (`#FF453A` suave / `#3A3A3C`).
2. **Tipografia & Zero Emojis:**
   - Números primários sempre em `#FFFFFF` (`font-semibold tracking-[-0.03em] tabular-nums`), mantendo a leitura executiva limpa; badges sutis ao lado informam a taxa (`79.2%`, `56.7%`).
   - Substituição de todos os emojis (`🟢`, `🔴`, `🟡`, `📣`, `🎯`) por pontos ópticos de `6px` e ícones SVG lineares de `1.5px`.
3. **Stepper de Conversão por Lead:**
   - Linha horizontal minimalista de 3 nós dentro de cada card:
     - Nó 1: `Entrou` (`HH:mm:ss`)
     - Nó 2: `Redirect` (`HH:mm:ss` ou `—`)
     - Nó 3: `Contato` (`HH:mm:ss` + badge `⚡ 16s` ou motivo da perda `Saiu da pág.` / `Não enviou msg`)

---

## 3. Contratos dos Leads Demonstrativos (`seed_demo_leads.js`)

### 3.1. Funções no `leads_db.js` / `seed_demo_leads.js`
- `seedDemoLeads(options = {})`:
  - Remove eventuais registros `visit_id LIKE 'demo_%'` anteriores (idempotente) e insere **6 leads demonstrativos realistas** cobrindo 100% dos cenários do funil e da Google Tag:
    1. `demo_msg_code_01`: **Mandou Mensagem** via `Código: K7M9P2` (Google Ads, Campanha `Pesquisa_Oficina_ABC`, Conjunto `Cambio_Automatico`, `gclid` + `gad_source=1`, Nome `Carlos Eduardo Mendes`, Tel `5511984123390`, tempo de resposta `16s`).
    2. `demo_msg_phone_02`: **Mandou Mensagem** via Telefone E.164 (Google Ads, Campanha `Diagnostico_SP`, Conjunto `Injecao_Eletronica`, `gclid` ativo, Nome `Fernanda Rocha`, Veículo `Jeep Compass 2021`, Tel `5511972308814`).
    3. `demo_redirect_wait_03`: **Redirecionado (Aguardando)** (`Código: R4T8N2`, Campanha `Pesquisa_Oficina_ABC`, Conjunto `Motor_e_Cabecote`, `gclid` + `gad_source=1`, redirecionado agora).
    4. `demo_lost_nomsg_04`: **Perdido — Não Chamou no WhatsApp** (`lost_reason = 'NAO_CHAMOU_WHATSAPP'`, `Código: P9X3L7`, Campanha `Diagnostico_SP`, Conjunto `Freios_ABS`, `gclid` ativo, redirecionado há 35 min sem enviar mensagem).
    5. `demo_lost_noredir_05`: **Perdido — Saiu sem Redirect** (`lost_reason = 'SEM_REDIRECT'`, Origem `meta`, `fbclid` ativo, Campanha `Remarketing_IG`, Conjunto `Reels_Oficina`, saiu em 3s).
    6. `demo_active_page_06`: **Na Página Agora** (`funnel_status = 'ENTROU'`, Google Pesquisa, Conjunto `Revisao_Preventiva`, `gclid` + `gbraid`, entrou agora).
  - Nota importante no `sweepExpiredSessions`: registros ativos de demonstração recém-criados (`demo_redirect_wait_03` e `demo_active_page_06`) recebem timestamps frescos no momento do seed para ilustrarem os estados ao vivo.
- `clearDemoLeads(options = {})`:
  - Executa `DELETE FROM leads_events WHERE visit_id LIKE 'demo_%'` e `DELETE FROM leads_sessions WHERE visit_id LIKE 'demo_%'`, retornando `{ deletedSessions }`.

### 3.2. Endpoints Autenticados no `web_server.js`
- `POST /leads/api/demo/seed` → Popula/renova os 6 leads demonstrativos.
- `POST /leads/api/demo/clear` → Limpa instantaneamente todos os leads `demo_%`.

---

## 4. Mapeamento de Arquivos Afetados

| Arquivo | Ação | Descrição |
| :--- | :--- | :--- |
| `projects/hydra-rede/src/leads_system/seed_demo_leads.js` | Criar | Gerador determinístico e limpador cirúrgico dos 6 cenários demonstrativos de leads, conjuntos de anúncios e Google Tag. |
| `projects/hydra-rede/src/leads_system/leads_db.js` | Atualizar | Expor helpers de contagem de leads demo (`demoCount`) no `getDashboardData`. |
| `projects/hydra-rede/src/leads_system/web_server.js` | Atualizar | Adicionar rotas protegidas `POST /leads/api/demo/seed` e `POST /leads/api/demo/clear`. |
| `projects/hydra-rede/src/leads_system/public/index.html` | Refatorar | Implementar Pager Horizontal com Física de Mola Real (Swipe 1:1 + Rubber-Band + Velocity + Liquid Pill na Tab Bar), Bottom Sheet com Drag-to-Dismiss e Redesign Anti-Slop completo dos KPIs e Cards. |
| `projects/hydra-rede/src/leads_system/test_leads_system.js` | Atualizar | Incluir testes automatizados para `demo/seed`, `demo/clear`, presença do motor de swipe físico e ausência de emojis slop no HTML. |
