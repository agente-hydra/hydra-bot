# Design Técnico: Estrutura Integrada de 7 Colunas & Compactação A4

**Spec ID:** `hydra-rede-venda-juros`  
**Data:** 07/10/2026  
**Status:** PROPOSTA / DESIGN ATUALIZADO  

---

## 1. Modelo Matemático do Cálculo Reverso

Para cada transação $i$ capturada no extrato da Rede:
* $V_{\text{bruto}}$: Valor bruto registrado na maquininha.
* $N$: Quantidade de parcelas (1 a 18).
* $T(N)$: Taxa de parcelamento para $N$ parcelas.
* $\text{Fator}(N) = 1 + \frac{T(N)}{100}$.

### Tabela de Parâmetros:
```javascript
const TABELA_REPASSE = {
  1:  { taxa: 0.000, divisor: 1.000 },
  2:  { taxa: 0.000, divisor: 1.000 },
  3:  { taxa: 0.000, divisor: 1.000 },
  4:  { taxa: 0.000, divisor: 1.000 },
  5:  { taxa: 0.105, divisor: 1.105 },
  6:  { taxa: 0.110, divisor: 1.110 },
  7:  { taxa: 0.115, divisor: 1.115 },
  8:  { taxa: 0.120, divisor: 1.120 },
  9:  { taxa: 0.125, divisor: 1.125 }, // 12,5% Confirmado
  10: { taxa: 0.130, divisor: 1.130 },
  11: { taxa: 0.135, divisor: 1.135 }, // 13,5% Confirmado
  12: { taxa: 0.140, divisor: 1.140 },
  13: { taxa: 0.145, divisor: 1.145 },
  14: { taxa: 0.150, divisor: 1.150 },
  15: { taxa: 0.155, divisor: 1.155 },
  16: { taxa: 0.160, divisor: 1.160 },
  17: { taxa: 0.175, divisor: 1.175 },
  18: { taxa: 0.180, divisor: 1.180 }
};
```

### Fórmulas Matemáticas da Linha:
$$V_{\text{original}} = \frac{V_{\text{bruto}}}{\text{Fator}(N)}$$
$$V_{\text{venda\_juros}} = V_{\text{bruto}} - V_{\text{original}}$$
$$V_{\text{juros\_rede}} = V_{\text{bruto}} - V_{\text{liquido}}$$
$$\text{Taxa Rede (\%)} = \frac{V_{\text{liquido}}}{V_{\text{bruto}}} - 1$$

---

## 2. Mockup Visual das Tabelas (7 Colunas por Loja)

### Loja Esquerda (Colunas A a G) | Canaleta H | Loja Direita (Colunas I a O)

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 🏢 1. PLANALTO (EC: 062923591)                                                         │
├─────────┬────────────┬─────────────┬─────────────┬────────────────┬─────────┬──────────┤
│ Tipo    │ Bandeira   │ Valor Bruto │ Líquido Taxa│ Venda de juros │ Taxa    │ Juros    │
├─────────┼────────────┼─────────────┼─────────────┼────────────────┼─────────┼──────────┤
│ C 11x   │ Visa       │ R$ 1.135,00 │ R$ 1.015,00 │ R$      135,00 │ -10,57% │ R$ 120,00│
│ C 8x    │ Master     │ R$ 2.240,00 │ R$ 2.016,00 │ R$      240,00 │ -10,00% │ R$ 224,00│
│ Débito  │ Elo        │ R$   300,00 │ R$   296,00 │ R$        0,00 │  -1,33% │ R$   4,00│
├─────────┴────────────┼─────────────┼─────────────┼────────────────┼─────────┼──────────┤
│ TOTAL PLANALTO:      │ R$ 3.675,00 │ R$ 3.327,00 │ R$      375,00 │  -9,47% │ R$ 348,00│
└──────────────────────┴─────────────┴─────────────┴────────────────┴─────────┴──────────┘
```

> **Nota sobre a coluna `Juros`:** Substitui integralmente a antiga coluna `Cobrado`. Ela reflete em R$ o valor retido pela maquininha Rede (`Valor Bruto − Líquido Taxa`).

---

## 3. Fórmulas Nativas do ExcelJS

### Linhas de Dados (exemplo na linha `r`):
* **`A{r}`:** Nome amigável do tipo e parcelas (`v.parcelas > 1 ? v.tipo + " " + v.parcelas + "x" : v.tipo`).
* **`B{r}`:** Bandeira (`v.bandeira`).
* **`C{r}`:** Valor Bruto numérico com formato moeda.
* **`D{r}`:** Líquido Taxa numérico com formato moeda.
* **`E{r}`:** Venda de juros: `{ formula: 'C' + r + ' - (C' + r + ' / Divisor)', result: v.vendaJuros }` ou valor calculado direto com formatação moeda.
* **`F{r}`:** Taxa: `{ formula: 'IF(C' + r + '>0, (D' + r + '/C' + r + ')-1, 0)' }` com formato `0.00%`.
* **`G{r}`:** Juros: `{ formula: 'C' + r + ' - D' + r + '', result: v.bruto - v.liquido }` com formato moeda.

### Linha de Subtotal da Loja:
* **`A{r}:B{r}`:** Mesclado com `TOTAL <LOJA>`.
* **`C{r}`:** `{ formula: 'SUM(C' + startRow + ':C' + endRow + ')' }`.
* **`D{r}`:** `{ formula: 'SUM(D' + startRow + ':D' + endRow + ')' }`.
* **`E{r}`:** `{ formula: 'SUM(E' + startRow + ':E' + endRow + ')' }`.
* **`F{r}`:** `{ formula: 'IF(C' + r + '>0, (D' + r + '/C' + r + ')-1, 0)' }`.
* **`G{r}`:** `{ formula: 'SUM(G' + startRow + ':G' + endRow + ')' }`.

---

## 4. Orçamento Vertical para Folha A4 Paisagem

Para eliminar o vazamento para a página 2, o cabeçalho foi compactado:

| Elemento | Altura Anterior | Altura Nova | Estilo |
|---|:---:|:---:|---|
| **Banner Principal (Linha 1)** | 26pt | **20pt** | Fonte Segoe UI 10.5 bold, fundo escuro |
| **Subtítulo (Linha 2)** | 18pt | **14pt** | Fonte Segoe UI 8.5 regular |
| **Espaçador Topo (Linha 3)** | 8pt | **3pt** | Vazio |
| **Labels de KPI (Linha 4)** | 16pt | **12pt** | Fonte Segoe UI 7.5 bold |
| **Valores de KPI (Linha 5)** | 24pt | **17pt** | Fonte Segoe UI 10.5 bold |
| **Espaçador Pós-KPI (Linha 6)** | 10pt | **4pt** | Vazio |
| **Espaçador Entre Lojas** | 12pt | **5pt** | Vazio |

---

## 5. Estrutura do Relatório no WhatsApp

O texto enviado para a diretoria reflete a nova estrutura:

```text
🚀 *RELATÓRIO DE JUROS E TAXAS • REDE*
📅 *Data:* 07/10/2026

📊 *CONSOLIDADO DA REDE:*
• 💳 *Faturamento Bruto Rede:* R$ 145.800,00
• 💰 *Líquido Total Creditado:* R$ 131.980,00
• 📈 *Total Venda de Juros (Clientes):* *R$ 14.550,00*
• 📉 *Total Juros/Taxas Retidos Rede:* *R$ 13.820,00* (9,48%)
• 🎯 *Spread Líquido da Loja:* *+R$ 730,00* (Superávit)

🏢 *POR UNIDADE (Venda de Juros vs Juros Rede):*
1. *Planalto:* Bruto: R$ 18.500 | Venda Juros: R$ 1.950 | Juros Rede: R$ 1.820 (+R$ 130)
2. *Piraporinha:* Bruto: R$ 22.100 | Venda Juros: R$ 2.400 | Juros Rede: R$ 2.280 (+R$ 120)
...
10. *Jabaquara:* Bruto: R$ 14.200 | Venda Juros: R$ 1.500 | Juros Rede: R$ 1.410 (+R$ 90)

📎 _Planilha oficial A4 Paisagem anexada._
```
