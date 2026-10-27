# Design Técnico: Spec 036 — Ajuste de Fidelidade de Dados de CMV, Faturamento, Metas, Pátio Ativo e Alerta de Serviço Prestado

## 1. Arquitetura e Fluxo de Dados

```
[ERP Oficina Inteligente]
       │
       ├─ (Horário :15) ───► relatorio_operacao_<slug>.json (CMV, Faturamento & % Serviço Prestado)
       │                     metas_rede.json (Meta monetária & atingimento)
       │
       └─ (Pátio & OS)  ───► os_store_<slug>.json (OSs abertas & checklists)
                                       │
                                       ▼
                       [whatsapp_patio_dispatcher.js]
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
  carregarDadosCmvEMetas()                              carregarPatioChecklist()
  - Prioriza relatorio_operacao_*.json                  - Inspeciona os_store_*.json
  - Extrai faturamento_percentual de 'SERVIÇO PRESTADO' - Valida frescor da leitura (<12h)
  - Cruza com metas_rede.json                           
            │                                                     │
            └──────────────────────────┬──────────────────────────┘
                                       ▼
    ┌──────────────────────────────────┴──────────────────────────────────┐
    ▼                                                                     ▼
formatarMsgCmvKpiGerente()                              formatarAlertaSociosServicoPrestado()
- Bolinha azul (🔵) no Bom                             - Agrupa lojas com Serviço Prestado < 45%
- Bolinhas sem texto (🟢, 🟡, 🔴, 🚨)                  - Formata balão executivo de rentabilidade
- Linha Serviço Prestado (🔴 <45% / 🟢 >=45%)          - Dispara para grupo '120363425738307789@g.us'
- Faturamento e Meta em linhas dedicadas
- Bloco de Pátio fiel às OSs em aberto
- Zero tabela de faixas no rodapé
                                       │
                                       ▼
                         run_cmv_kpi_gerentes.js
                        - Orquestrador CLI (Quarta/Sexta 14:30)
                        - Envio via instância remetente 'hydra'
                        - 1. Dispara mensagem individual para cada Gerente
                        - 2. Dispara alerta para Grupo dos Sócios se houver lojas < 45%
```

## 2. Contratos de Dados & Interfaces

### 2.1 Interface de Dados de Loja Atualizada
```typescript
export interface LojaCmvMetaItem {
  slug: string;
  nome: string;
  faturamento: number;          // Ex: 71640.61
  cmvPercentual: number | null; // Ex: 15.78
  metaMes: number | null;       // Ex: 99900
  percentualMeta: number | null;// Ex: -16
  servicoPrestadoFat: number;   // Ex: 31865.17
  servicoPrestadoPct: number;   // Ex: 44.48
}
```

### 2.2 Classificação do Serviço Prestado
```typescript
export function formatarLinhaServicoPrestado(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || isNaN(pct)) {
    return `- _Serviço Prestado:_ *N/D*`;
  }
  const val = Number(pct);
  const emoji = val >= 45.0 ? '🟢' : '🔴';
  const pctTxt = val.toFixed(2).replace('.', ',');
  return `- _Serviço Prestado:_ ${emoji} *${pctTxt}%*`;
}
```

### 2.3 Formatação do Balão de Alerta para o Grupo dos Sócios
```typescript
export function formatarAlertaSociosServicoPrestado({ lojasAbaixo45, dateBR, horaRef }: {
  lojasAbaixo45: Array<{ nome: string; servicoPct: number; servicoFat: number; totalFat: number }>;
  dateBR: string;
  horaRef?: string;
}): string {
  const hora = horaRef || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const count = lojasAbaixo45.length;
  const pluralLoja = count === 1 ? '1 unidade está operando' : `${count} unidades estão operando`;

  const linhasLojas = lojasAbaixo45.map(l => {
    const pctTxt = l.servicoPct.toFixed(2).replace('.', ',');
    const fatServTxt = Math.round(l.servicoFat).toLocaleString('pt-BR');
    const fatTotTxt = Math.round(l.totalFat).toLocaleString('pt-BR');
    return `• *${l.nome}:* 🔴 *${pctTxt}%* _(Serviços: R$ ${fatServTxt} / Total: R$ ${fatTotTxt})_`;
  }).join('\n');

  return [
    `*HYDRA | Alerta de Rentabilidade — Serviço Prestado < 45%*`,
    `_${dateBR} · Posição às ${hora} • Diretoria Hydra_`,
    `⚠️ *Atenção Diretoria:* ${pluralLoja} com participação de mão de obra (Serviço Prestado) abaixo do piso mínimo de *45%* no mês:`,
    linhasLojas,
    `_Meta da Rede: Mínimo 45% de serviços próprios para sustentabilidade da margem de contribuição._`
  ].join('\n\n');
}
```

## 3. Modelo Visual das Mensagens Formatadas

### 3.1 Mensagem Individual para o Gerente da Loja (Kennedy)
```markdown
*HYDRA | Indicadores de Loja — Kennedy*
_27/10/2026 · Posição às 11:45 • Turno da Tarde_

*CMV do Mês:* 🔵 *15,78%*
- _Faturamento Acumulado:_ *R$ 71.640,61*
- _Meta do Mês:_ *R$ 99.900,00* (-16%)
- _Serviço Prestado:_ 🔴 *44,48%*

*Pátio & Checklist do Mecânico*
- _Carros no pátio ativo:_ *4 veículos*
- _Com checklist:_ *4* (100%)
- _Sem checklist:_ *0 pendências* ✅

_Acompanhamento de performance de unidade · Diretoria Hydra_
```

### 3.2 Mensagem Individual para o Gerente da Loja (Santo André — Serviço Prestado Conforme)
```markdown
*HYDRA | Indicadores de Loja — Santo André*
_27/10/2026 · Posição às 11:45 • Turno da Tarde_

*CMV do Mês:* 🟢 *22,60%*
- _Faturamento Acumulado:_ *R$ 115.332,96*
- _Meta do Mês:_ *R$ 139.900,00* (-3%)
- _Serviço Prestado:_ 🟢 *51,36%*

*Pátio & Checklist do Mecânico*
- _Carros no pátio ativo:_ *6 veículos*
- _Com checklist:_ *6* (100%)
- _Sem checklist:_ *0 pendências* ✅

_Acompanhamento de performance de unidade · Diretoria Hydra_
```

### 3.3 Mensagem Coletiva para o Grupo dos Sócios (`120363425738307789@g.us`)
```markdown
*HYDRA | Alerta de Rentabilidade — Serviço Prestado < 45%*
_27/10/2026 · Posição às 14:30 • Diretoria Hydra_

⚠️ *Atenção Diretoria:* 5 unidades estão operando com participação de mão de obra (Serviço Prestado) abaixo do piso mínimo de *45%* no mês:

• *Rei do Módulo:* 🔴 *26,18%* _(Serviços: R$ 23.737 / Total: R$ 90.673)_
• *Jorge Beretta:* 🔴 *42,64%* _(Serviços: R$ 29.540 / Total: R$ 69.273)_
• *Rudge Ramos:* 🔴 *43,03%* _(Serviços: R$ 52.755 / Total: R$ 122.601)_
• *Jabaquara:* 🔴 *44,19%* _(Serviços: R$ 33.397 / Total: R$ 75.572)_
• *Kennedy:* 🔴 *44,48%* _(Serviços: R$ 31.865 / Total: R$ 71.641)_

_Meta da Rede: Mínimo 45% de serviços próprios para sustentabilidade da margem de contribuição._
```

## 4. Arquivos Impactados
1. `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
   - `classifyKPI`: Bom como `🔵`.
   - `carregarDadosCmvEMetas`: Extrair `servicoPrestadoFat` e `servicoPrestadoPct` de `relatorio_operacao_<slug>.json` e da tabela SQLite `faturamento_areas`.
   - `formatarMsgCmvKpiGerente`:
     - Exibir linha `- _Serviço Prestado:_ ${emoji} *${pctTxt}%*`.
     - Faturamento e Meta em duas linhas dedicadas em reais.
     - Remover bloco de faixas de CMV da diretoria.
     - Remover textos `(BOM)`.
   - `formatarAlertaSociosServicoPrestado`: Nova função para gerar o balão executivo dos sócios.
2. `projects/hydra-rede/src/run_cmv_kpi_gerentes.js`:
   - Disparo individual para gerentes.
   - Detecção de lojas com `servicoPrestadoPct < 45%` e envio do balão para o grupo dos sócios (`120363425738307789@g.us`).
   - Redirecionamento seguro para o Dev em caso de `--target=dev`.
3. `projects/hydra-rede/src/test_cmv_kpi_gerentes.js`:
   - Testar semáforo de Serviço Prestado (<45% vermelho, >=45% verde).
   - Testar montagem do alerta para o grupo dos sócios.
