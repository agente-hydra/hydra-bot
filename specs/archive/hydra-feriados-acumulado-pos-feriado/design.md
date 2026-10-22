# Design Técnico — Calendário de Feriados e Janela Acumulada Dinâmica (hydra-feriados-acumulado-pos-feriado)

**Spec ID:** `hydra-feriados-acumulado-pos-feriado`  
**Data:** 09/10/2026  
**Status:** Design  

---

## 1. Arquitetura do Módulo de Calendário

O módulo `feriados_calendario.js` (CJS para `hydra-rede`) e `feriados_calendario.ts` (TS para `hydra-sync`) fornece uma fonte determinística e isolada para todas as rotinas que dependem de datas operacionais.

### 1.1 Feriados Nacionais Oficiais Suportados

1. **Feriados Fixos:**
   - `01-01`: Confraternização Universal (Ano Novo)
   - `21-04`: Tiradentes
   - `01-05`: Dia Mundial do Trabalho
   - `07-09`: Independência do Brasil
   - **`12-10`**: **Nossa Senhora Aparecida / Dia das Crianças**
   - `02-11`: Finados
   - `15-11`: Proclamação da República
   - `20-11`: Dia Nacional da Consciência Negra (Lei Federal 14.759/2023)
   - `25-12`: Natal
2. **Feriados Móveis (Baseados no Algoritmo de Butcher/Meeus para a Páscoa):**
   - Carnaval (Segunda e Terça-feira de Carnaval: Páscoa - 48 dias e Páscoa - 47 dias)
   - Sexta-feira Santa / Paixão de Cristo: Páscoa - 2 dias
   - Corpus Christi: Páscoa + 60 dias

---

## 2. Assinaturas e Contratos de Tipos (TypeScript Strict)

```typescript
export interface InformacaoFeriado {
  readonly isFeriado: boolean;
  readonly nome?: string;
  readonly tipo?: 'nacional_fixo' | 'nacional_movel' | 'estadual_sp' | 'customizado';
}

export interface JanelaAcumulada {
  readonly dataInicioBR: string;    // "DD/MM/YYYY" (ex: "09/10/2026")
  readonly dataFimBR: string;       // "DD/MM/YYYY" (ex: "12/10/2026")
  readonly dataInicioISO: string;   // "YYYY-MM-DD" (ex: "2026-10-09")
  readonly dataFimISO: string;      // "YYYY-MM-DD" (ex: "2026-10-12")
  readonly dateTagBR: string;       // "DD-MM-AAAA" (ex: "13-10-2026", data do relatório gerado)
  readonly datasAlvoBR: readonly string[]; // ["09/10/2026", "10/10/2026", "11/10/2026", "12/10/2026"]
  readonly datasAlvoISO: readonly string[];
  readonly diasCobertos: number;    // ex: 4
  readonly isPeriodoEstendido: boolean; // true quando engloba fim de semana ou pós-feriado
  readonly motivo: 'dia_comum' | 'segunda_feira' | 'pos_feriado';
  readonly descricao: string;
}
```

---

## 3. Algoritmo de Janela Acumulada (`calcularJanelaAcumulada`)

O objetivo é responder: **"Dado que hoje é a data de execução `D` (às 08:00 AM), quais datas de fechamento/movimento devem ser reportadas?"**

### 3.1 Lógica de Retrocesso:
1. Começar em `ontem = D - 1 dia`.
2. Se `D` for um dia normal (ex: quarta-feira sem feriado anterior):
   - Ontem (terça) foi dia de despacho normal.
   - Período: apenas Ontem (`dias = [D - 1]`).
3. Se `D` for Segunda-feira (sem feriado):
   - O último despacho ocorreu na Sexta-feira passada (`D - 3`).
   - O período a reportar acumulado é: Sexta (`D - 3`), Sábado (`D - 2`), Domingo (`D - 1`).
4. Se `D` for Terça-feira e Segunda-feira (`D - 1`) foi Feriado:
   - Na Segunda-feira NÃO houve despacho (oficinas fechadas).
   - O último despacho ocorreu na Sexta-feira passada (`D - 4`).
   - O período a reportar acumulado é: Sexta (`D - 4`), Sábado (`D - 3`), Domingo (`D - 2`) e Segunda (`D - 1`).
   - `dataInicio` = `D - 4` (09/10/2026).
   - `dataFim` = `D - 1` (12/10/2026).
5. Regra Geral de Conexão:
   - Retrocede dia a dia a partir de `D - 1` até encontrar o **último dia em que houve expediente e despacho matinal** (ou seja, o dia útil que teve envio às 08:00).
   - A `dataInicio` é o primeiro dia após o último despacho até `D - 1`.

---

## 4. Integração nos Módulos do Sistema

### 4.1 Em `projects/hydra-rede/src/run_unified_morning_dispatch.js`
Logo após determinar `targetDate`:
```javascript
const { verificarFeriado, calcularJanelaAcumulada } = require('./feriados_calendario');

const infoFeriadoHoje = verificarFeriado(targetDate);
if (infoFeriadoHoje.isFeriado && !isForce) {
  log(`🛑 HOJE É FERIADO NACIONAL: ${infoFeriadoHoje.nome} (${dateTagBR}).`);
  log(`O despacho matinal dos 4 relatórios oficiais está SUSPENSO.`);
  log(`Os dados deste feriado e do final de semana serão acumulados na reabertura do próximo dia útil.`);
  return;
}
```

### 4.2 Em `projects/hydra-rede/src/date_resolver.js` (Juros Rede)
Substituir a checagem ingênua de `dayOfWeek === 1`:
```javascript
const { calcularJanelaAcumulada } = require('./feriados_calendario');
// Utiliza a janela acumulada resolvida para preencher targetDatesBR e displayPeriod
```

### 4.3 Em `projects/hydra-rede/src/exportar_contas_pagar_cli.js` e `src/hydra-sync/contas_pagar_crawler.ts`
Substituir `calcularPeriodoContasPagar`:
```javascript
function calcularPeriodoContasPagar(dataRef = new Date()) {
  const janela = calcularJanelaAcumulada(dataRef);
  return {
    dataInicialFormatada: janela.dataInicioBR,
    dataFinalFormatada: janela.dataFimBR,
    dateTagBR: janela.dateTagBR,
    isPeriodoEstendido: janela.isPeriodoEstendido,
    diasCobertosDescricao: janela.descricao
  };
}
```

---

## 5. Casos de Teste Automatizados

1. **Teste T-HOL-01 (Segunda 12/10/2026):**
   - Entrada: `2026-10-12`
   - `isFeriado`: `true` (Nossa Senhora Aparecida).
   - Dispatcher: Encerra com suspensão de envio (zero disparos).
2. **Teste T-HOL-02 (Terça 13/10/2026 - Pós-Feriado):**
   - Entrada: `2026-10-13`
   - `isFeriado`: `false`.
   - `dataInicioBR`: `09/10/2026` (Sexta-feira).
   - `dataFimBR`: `12/10/2026` (Segunda-feira feriado).
   - `datasAlvoBR`: `['09/10/2026', '10/10/2026', '11/10/2026', '12/10/2026']`.
   - `motivo`: `'pos_feriado'`.
3. **Teste T-HOL-03 (Quarta 14/10/2026 - Dia Comum):**
   - Entrada: `2026-10-14`
   - `dataInicioBR`: `13/10/2026`.
   - `dataFimBR`: `13/10/2026`.
   - `motivo`: `'dia_comum'`.
4. **Teste T-HOL-04 (Segunda Comum 05/10/2026):**
   - Entrada: `2026-10-05`
   - `dataInicioBR`: `02/10/2026` (Sexta).
   - `dataFimBR`: `04/10/2026` (Domingo).
   - `motivo`: `'segunda_feira'`.
