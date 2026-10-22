# Proposta — Calendário de Feriados, Supressão em Dias Não Úteis e Puxada Acumulada na Reabertura

**Spec ID:** `hydra-feriados-acumulado-pos-feriado`  
**Data:** 09/10/2026  
**Status:** Proposta  
**Prioridade:** Alta (Feriado Nacional na próxima segunda-feira, 12/10/2026)  

---

## 1. Problema de Negócio

No ecossistema atual da Hydra:
1. **Disparo Cego em Feriados:**
   - O orquestrador matinal (`run_unified_morning_dispatch.js`) é agendado no cron da VPS de segunda a sexta-feira (`45 7 * * 1-5`).
   - Ele não possui consciência de calendário bancário/nacional brasileiro.
   - Na próxima segunda-feira, **12/10/2026 (Nossa Senhora Aparecida / Dia das Crianças)**, as lojas físicas estarão fechadas e a diretoria estará de folga, mas o bot tentaria rodar e disparar relatórios desnecessariamente às 08:00 AM.
2. **Perda de Dados na Terça-feira Seguinte:**
   - Atualmente, as rotinas de data (`date_resolver.js` e `calcularPeriodoContasPagar`) verificam apenas o dia da semana bruto:
     - `getDay() === 1` (Segunda-feira): puxa sexta, sábado e domingo.
     - `getDay() === 2` a `5` (Terça a Sexta): puxa estritamente ontem (D-1).
   - Se na segunda-feira (12/10) o bot não rodar ou as lojas estiverem fechadas, **na terça-feira (13/10)** a rotina atual puxaria **apenas a data de ontem (segunda 12/10)**.
   - **Consequência grave:** Todos os lançamentos, pagamentos, juros e vendas de **Sexta-feira (09/10)** e **Sábado (10/10)** seriam **completamente omitidos e perdidos** na conciliação da diretoria.

---

## 2. Solução Proposta

Implementar inteligência de calendário de feriados nacionais e mecanismo de **Janela Acumulada Dinâmica**:

1. **Módulo Soberano de Calendário (`feriados_calendario.js` / `.ts`):**
   - Tabela de feriados nacionais fixos (ex: 01/01, 21/04, 01/05, 07/09, **12/10 - N. Sra. Aparecida**, 02/11, 15/11, 20/11, 25/12) e cálculo determinístico de feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi).
   - Funções:
     - `isFeriado(data)`: indica se uma data é feriado nacional.
     - `calcularJanelaAcumulada(dataRef)`: calcula o intervalo completo desde o último dia útil despachado até ontem.
2. **Supressão Automática em Feriados (Zero Envio no WhatsApp):**
   - No início de `run_unified_morning_dispatch.js`:
     - Se `isFeriado(targetDate) === true`, o orquestrador registra log explicativo:
       `[Calendário] Hoje (12/10/2026) é feriado nacional (Nossa Senhora Aparecida). Despacho matinal suspenso.`
     - Encerra a execução com código 0 e **NÃO envia nenhuma mensagem ou arquivo no WhatsApp**.
3. **Puxada Acumulada Automática no Primeiro Dia Útil (Terça-feira 13/10):**
   - Na terça-feira (13/10), o bot detecta que ontem (12/10) foi feriado e que o último dia despachado foi sexta-feira (09/10).
   - A janela de datas é automaticamente expandida para o período completo:
     - **Data Inicial:** `09/10/2026` (sexta-feira passada)
     - **Data Final:** `12/10/2026` (ontem / segunda-feira feriado)
   - **Contas a Pagar:** filtra no ERP e no SQLite de `09/10/2026` a `12/10/2026` (pegando pagamentos de sexta, sábado e segunda).
   - **Juros Rede:** concilia todas as transações das datas `[09/10/2026, 10/10/2026, 11/10/2026, 12/10/2026]`.
   - **Carros em Pátio:** gera snapshot fresco consolidado da reabertura na terça-feira de manhã.
   - **Mapa de Metas:** consolida as metas do mês atualizadas até o feriado.

---

## 3. Contratos e Regras de Negócio

### 3.1 Tabela de Comportamento para Outubro/2026

| Data | Dia da Semana | Condição | Ação do Bot | Intervalo Coberto |
| :--- | :--- | :--- | :--- | :--- |
| **09/10/2026** | Sexta | Dia útil normal | Dispara às 08:00 AM | Ontem: `08/10/2026` |
| **10/10/2026** | Sábado | Fim de semana | Cron não agenda | — |
| **11/10/2026** | Domingo | Fim de semana | Cron não agenda | — |
| **12/10/2026** | Segunda | **Feriado Nacional (Aparecida)** | **SUSPENDE DISPARO (Zero WhatsApp)** | — |
| **13/10/2026** | Terça | **Reabertura Pós-Feriado** | **Dispara às 08:00 AM (Acumulado)** | **`09/10/2026` até `12/10/2026`** |
| **14/10/2026** | Quarta | Dia útil normal | Dispara às 08:00 AM | Ontem: `13/10/2026` |

---

## 4. Riscos e Mitigações

- **Risco:** Override manual via CLI (`--date=...` ou `--force`) ser bloqueado pela trava de feriado.  
  **Mitigação:** Suporte explícito à flag `--force` para permitir testes e re-disparos manuais pelo desenvolvedor mesmo em feriados.
- **Risco:** Incompatibilidade entre os módulos CJS de `hydra-rede` e TS de `hydra-sync`.  
  **Mitigação:** Criação de implementação CJS em `projects/hydra-rede/src/feriados_calendario.js` e espelhamento consistente em `src/hydra-sync/feriados_calendario.ts`.
