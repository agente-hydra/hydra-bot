# Design — Spec 034: CMV KPI Alert por Gerente

**ID:** `034-cmv-kpi-alerta-gerentes-quarta-sexta`

---

## Fluxo de Dados

```
crontab: 30 14 * * 3,5  (Quarta=3, Sexta=5, 14:30 BRT)
    │
    ▼
run_cmv_kpi_gerentes.js --immediate
    │
    ├─ 1. Pre-flight WhatsApp (probeAndHealEvolutionInstance)
    │
    ├─ 2. Verificar feriado (verificarFeriado)
    │
    ├─ 3. Carregar CMV de todas as lojas
    │       └── carregarDadosCmvEMetas() → [{slug, nome, cmvPercentual, faturamento}]
    │
    ├─ 4. Carregar Pátio + Checklist por loja
    │       └── os_store_<slug>.json → {totalAbertas, comChecklist, semChecklist}
    │
    ├─ 5. Carregar gerentes ativos
    │       └── hydra_ops.db > hydra_store_managers WHERE is_active=1
    │
    ├─ 6. Para cada gerente:
    │       ├── Badge KPI do CMV
    │       ├── Resumo pátio com/sem checklist
    │       └── sendText(msg, phone_canonical)  [via instância hydra]
    │
    └─ 7. Log resultado + alerta Dev se falha > 0
```

---

## Módulos a Criar / Modificar

### NOVO: `src/run_cmv_kpi_gerentes.js`
Orquestrador principal. Headless, CJS (`require`), sem dependências externas novas.

### MODIFICAR: `src/whatsapp_patio_dispatcher.js`
Adicionar e exportar `formatarMsgCmvKpiGerente()`.

---

## Interfaces Reais (copiadas do código fonte)

### `carregarDadosCmvEMetas()` — já existe, já exportada
```js
// Retorna (linha 1345 do whatsapp_patio_dispatcher.js)
{
  lojas: Array<{
    slug: string;           // 'MPrudge', 'MPJabaquara', etc.
    nome: string;           // 'Rudge Ramos', 'Jabaquara', etc.
    faturamento: number;    // faturamento acumulado do mês
    cmvPercentual: number | null;
    metaMes: number | null;
    percentualMeta: number | null;
  }>;
  faturamentoTotal: number;
  cmvMedioRede: number;
}
```

### `hydra_store_managers` — tabela real no hydra_ops.db
```sql
loja_slug        TEXT PRIMARY KEY
loja_nome        TEXT NOT NULL
gerente_nome     TEXT NOT NULL
phone_canonical  TEXT NOT NULL   -- ex: '5511933733131'
instance_evolution TEXT          -- NÃO USAR como remetente
is_active        INTEGER DEFAULT 1
```

### `os_store_<slug>.json` — estrutura confirmada
```js
{
  slug_loja: string;
  nome_amigavel: string;
  ultima_atualizacao: string;  // ISO 8601
  os_map: {
    [osId: string]: {
      is_aberta: boolean;
      checklists: Array<{
        codigo: string;
        tipo: string;          // 'Check-List de Inspeção'
        realizado_por: string;
        status: string;        // 'Finalizado' | 'Pendente' | etc.
        progresso: string;     // '95,83 %'
        termino: string;
      }>;
      // ... outros campos
    }
  }
}
```

### `sendText(text, targetNumber)` — já existe, já exportada
```js
// whatsapp_patio_dispatcher.js:1059
// Usa EVO_INSTANCE = 'hydra' (hardcoded no env)
// Tem BLOCKED_TARGETS guard
async function sendText(text: string, targetNumber: string): Promise<{ ok: boolean; error?: string }>
```

### `probeAndHealEvolutionInstance(name)` — já existe (spec 033)
```js
// whatsapp_patio_dispatcher.js (adicionado em spec 033)
async function probeAndHealEvolutionInstance(instanceName: string): Promise<{ ok: boolean; state: string }>
```

### `verificarFeriado(date)` — já existe
```js
// src/feriados_calendario.js
function verificarFeriado(date: Date): boolean
```

---

## Badge KPI — Lógica de Classificação

```js
/**
 * classifyKPI — Classifica percentual de CMV em faixa KPI
 * Faixas definidas pelo usuário em 2026-10-27
 */
function classifyKPI(cmvPct) {
  if (cmvPct <= 21.99) return { label: 'BOM',                emoji: '✅', faixa: 1 };
  if (cmvPct <= 24.99) return { label: 'DENTRO DO OBJETIVO', emoji: '🟢', faixa: 2 };
  if (cmvPct <= 26.99) return { label: 'ALERTA',             emoji: '🟡', faixa: 3 };
  if (cmvPct <= 29.99) return { label: 'FORA DO OBJETIVO',   emoji: '🔴', faixa: 4 };
  return                      { label: 'CRÍTICO',             emoji: '🚨', faixa: 5 };
}
```

> [!IMPORTANT]
> As faixas são **exatas conforme o usuário definiu**:
> - ≤ 21,99% → BOM ✅
> - 22,00% – 24,99% → DENTRO DO OBJETIVO 🟢
> - 25,00% – 26,99% → ALERTA 🟡
> - 27,00% – 29,99% → FORA DO OBJETIVO 🔴
> - ≥ 30,00% → CRÍTICO 🚨

---

## Formato da Mensagem por Gerente

```
*HYDRA | CMV & Pátio — [Nome da Loja]* 📊
_[Data de referência: DD/MM/AAAA • Turno: Tarde]_

━━━━━━━━━━━━━━━━━━━━━
*CMV do Mês* 
[emoji] *[XX,X%]* — [LABEL]
_Faturamento acumulado: R$ [XXX.XXX,XX]_
━━━━━━━━━━━━━━━━━━━━━
*Pátio Ativo*
🚗 Total de carros: *[N]*
✅ Com checklist: *[N]* ([XX%])
⚠️ Sem checklist: *[N]*
━━━━━━━━━━━━━━━━━━━━━
_Dados atualizados às [HH:MM] | Hydra Ops_
```

**Fallback se os_store for stale (> 12h):**
A linha de Pátio é substituída por:
```
🚗 Pátio: _dados desatualizados (última leitura há +12h)_
```

**Fallback se CMV for null:**
Mensagem não enviada para esta loja; registra em log e alerta Dev.

---

## Segurança — Trava Dupla

```js
// 1. Blocklist existente no sendText (já protege contra REDE MECANICA POPULAR)
// 2. Nova trava: verificar que phone_canonical não está em BLOCKED_MANAGER_PHONES
// NUNCA usar phone_canonical como remetente — só como destinatário
// A instância remetente é SEMPRE 'hydra' (EVO_INSTANCE do .env)

const BLOCKED_MANAGER_PHONES = []; // Gerentes são DESTINATÁRIOS, não remetentes.
// O AGENTS.md proíbe usar instâncias de gerentes como REMETENTES.
// Neste caso, gerentes recebem mensagens da instância 'hydra' — isso é permitido.
```

---

## Crontab — Entrada a Adicionar

```bash
# 034 — CMV KPI Alert Individual por Gerente (Quarta e Sexta, 14:30 BRT)
30 14 * * 3,5 /usr/bin/node /home/operacional/hydra-rede/src/run_cmv_kpi_gerentes.js --immediate >> /home/operacional/hydra-data/logs/cmv-kpi-gerentes.log 2>&1
```

---

## Módulos NÃO Afetados

- `run_group_balloon_dispatch.js` — balões do grupo continuam sem mudança
- `run_unified_morning_dispatch.js` — esteira matinal sem mudança
- `excel_patio_builder.js` — planilha sem mudança
- `sanity_gate_patio_rede.js` — sanity gate sem mudança
