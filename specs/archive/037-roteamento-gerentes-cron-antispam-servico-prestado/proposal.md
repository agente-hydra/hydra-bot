# Spec 037 — Roteamento Quarta/Sexta 14:00 por Gerente & Blindagem Anti-Spam por Transição de Estado em Serviço Prestado (< 45%)

## 1. Problema

1. **Roteamento por Gerente (Quarta e Sexta às 14:00):**
   - No cron atual da VPS, o script estava configurado para `30 14 * * 3,5` (14:30 PM). A diretoria determinou que o disparo deve ocorrer pontualmente às **14:00 PM** (Quarta e Sexta).
   - O roteamento deve mapear deterministicamente cada gerente ativo da base (`hydra_store_managers`), garantindo que o gerente receba exclusivamente a sua unidade com o novo layout visual Hermes 2.0 (sem faixas de diretoria, com blockquotes `> *Seção*`, bolinha azul `🔵` no CMV meta batida e indicador de mão de obra).
   - **Cláusula Pétrea de Segurança:** Remetente exclusivo `hydra` (terminantemente proibido usar números ou instâncias de gerentes).

2. **Dilema da Atualização Horária vs. Flood de Mensagens no Grupo dos Sócios:**
   - O worker de finanças da Hydra (`hourly_finance_worker.ts`) roda a cada hora (às :15 de 08:00 às 22:00) extraindo o `Relatório de Operação` e `Gestão Periódica` do ERP Oficina Inteligente.
   - Se o sistema disparar um comunicado para o Grupo dos Sócios (`120363425738307789@g.us`) toda vez que a rotina horária rodar e detectar lojas com Serviço Prestado < 45%, o grupo receberá **até 15 alertas idênticos por dia**.
   - Isso satura o canal executivo, gera fadiga de alerta e faz a diretoria silenciar as notificações ou ignorar problemas reais.

---

## 2. Solução Proposta

### A. Roteamento de Gerentes (Quarta e Sexta às 14:00)
- Atualização do agendador crontab na VPS para `0 14 * * 3,5`.
- Orquestração determinística via `run_cmv_kpi_gerentes.js`:
  1. Carrega gerentes ativos de `hydra_store_managers` no SQLite `hydra_ops.db`.
  2. Carrega dados consolidados do mês em `carregarDadosCmvEMetas()`.
  3. Carrega checklist e carros ativos em `carregarPatioChecklist()`.
  4. Realiza pre-flight healthcheck do socket Baileys da instância `hydra`.
  5. Envia mensagem individual formatada em Hermes 2.0 com espaçamento humano de 2.000ms entre gerentes.
  6. Registra cada despacho com timestamp e status HTTP em `whatsapp_delivery_logs`.

---

### B. Blindagem Anti-Spam / Anti-Flood para Alerta de Serviço Prestado (< 45%)
Para evitar repetição exaustiva a cada hora, implementamos a arquitetura de **Gatilho por Transição de Estado (State-Machine Delta) com Cooldown e Teto Diário**:

```
[Hourly Finance Worker (:15)]
              │
              ▼
   Extrai 10 Lojas no ERP
              │
              ▼
[State Evaluator de Serviço Prestado]
  - Calcula % de Mão de Obra das 10 lojas
  - Identifica lojas < 45.0%
  - Gera Assinatura de Estado (Hash Ordenado dos Slugs Críticos)
              │
              ▼
    [Anti-Spam Gate SQLite]
    ┌────────────────────────────────────────────────────────┐
    │ 1. É a primeira apuração válida do dia (ex: ~11:15)?   │ ── SIM ──> [DISPARA CONSOLIDADO MANHÃ]
    │ 2. Houve NOVA loja que caiu abaixo de 45% (Delta)?     │ ── SIM ──> [DISPARA ALERTA IMEDIATO (DELTA)]
    │ 3. É a janela de fechamento vespertino (ex: ~17:15)?   │ ── SIM ──> [DISPARA CONSOLIDADO TARDE]
    │ 4. Estado IDÊNTICO ou variação residual sem nova loja?  │ ── SIM ──> ⛔ SILÊNCIO ABSOLUTO (SEM SPAM)
    │ 5. Cooldown mínimo de 3 horas entre disparos gerais?    │ ── NÃO ──> ⛔ BLOQUEIA ATÉ RESPEITAR JANELA
    └────────────────────────────────────────────────────────┘
```

#### Regras da Máquina de Estados Anti-Spam:
1. **Regra da Idempotência de Estado (Zero Repetição Cega):**
   - Se às 11:15 o alerta disparou com as lojas `[Rei do Módulo, Jorge Beretta, Rudge, Jabaquara, Kennedy]` e às 12:15, 13:15, 14:15 a lista for a mesma, o bot **NÃO envia nada**.
2. **Gatilho de Evento Crítico (Nova Loja Quebrou o Piso):**
   - Se às 13:15 uma nova unidade que estava conforme cair abaixo de 45% (ex: *Planalto* caiu para 43,8%), o bot detecta o `NEW_BREACH_EVENT` e **dispara imediatamente**, com uma linha de destaque indicando a nova entrada.
3. **Janela de Cooldown Mínimo:**
   - Cooldown de no mínimo 3 horas entre comunicados no grupo para o mesmo conjunto de lojas, prevenindo oscilações decimais (ex: 44,5% -> 44,4%).
4. **Teto Máximo Executivo Diário:**
   - No máximo **2 comunicados de rotina por dia** no grupo dos sócios (um consolidado de manhã ~11:15 e um de fechamento ~17:15) + até 1 disparo de exceção caso haja evento de nova loja crítica.

---

## 3. Contratos de Dados

### Tabela SQLite: `hydra_servico_prestado_state`
```sql
CREATE TABLE IF NOT EXISTS hydra_servico_prestado_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_referencia TEXT NOT NULL,           -- YYYY-MM-DD
  lojas_criticas_hash TEXT NOT NULL,       -- Hash ordenado das lojas < 45%
  lojas_criticas_json TEXT NOT NULL,       -- Detalhe JSON de lojas, percentuais e valores
  total_lojas_criticas INTEGER NOT NULL,   -- Qtd de lojas críticas
  motivo_disparo TEXT NOT NULL,            -- PRIMEIRA_APURACAO | NOVA_LOJA_CRITICA | ROTINA_TARDE
  novas_lojas_json TEXT,                   -- Lojas que acabaram de entrar no alerta
  recuperadas_json TEXT,                   -- Lojas que saíram do alerta
  disparado_em TEXT NOT NULL               -- ISO8601
);
```

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Instância `hydra` desconectada na hora do cron das 14:00 | Falha na entrega aos gerentes | `probeAndHealEvolutionInstance` integrado reinicia o socket Baileys preventivamente 30s antes do envio. |
| Crawlers da manhã atrasarem e gerarem dados parciais às 08h | Falso alarme de loja com 0% | Gate de maturação: só avalia alertas de Serviço Prestado após as 10:30 AM ou quando faturamento acumulado da loja for > R$ 5.000. |
| Telefone de gerente incorreto ou inativo | Erro 400 na Evolution API | Validação canônica de telefone e log detalhado em `whatsapp_delivery_logs`, sem interromper o envio das demais lojas. |
| Spam acidental no grupo dos sócios | Fadiga e reclamações da diretoria | Trava dupla: hash de estado + cooldown de 3h + teto de 2 envios/dia. |
