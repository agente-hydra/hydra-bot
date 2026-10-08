# Proposta: Estrutura Integrada de Venda de Juros & Compactação A4 Paisagem

**Spec ID:** `hydra-rede-venda-juros`  
**Data:** 07/10/2026  
**Status:** PROPOSTA ATUALIZADA / AGUARDANDO APROVAÇÃO (SDD Hard Stop)  
**Autor:** Antigravity Pair-Programming com Diretoria  

---

## 1. Contexto & Regra de Negócio

Nas operações de cartão de crédito parcelado (5x a 18x) nas maquininhas Rede, a loja repassa os juros do parcelamento ao cliente no ato da venda.

* O **Valor Bruto na Rede** já contém os juros embutidos cobrados do cliente.
* O cálculo reverso decompõe o Bruto em:
  $$\text{Valor Original} = \frac{\text{Valor Bruto na Rede}}{1 + \text{Taxa de Parcelamento}}$$
  $$\text{Venda de Juros} = \text{Valor Bruto na Rede} - \text{Valor Original}$$

### Exemplo Oficial Validado:
* Venda em **11 parcelas (taxa de 13,5%)** com valor bruto passado na máquina de **R$ 1.135,00**:
  * Divisor: $1,135$
  * $\text{Valor Original} = 1.135,00 / 1,135 = \text{R\$\ } 1.000,00$
  * $\text{Venda de Juros} = 1.135,00 - 1.000,00 = \text{R\$\ } 135,00$

---

## 2. Tabela Oficial de Taxas Confirmadas

| Parcelas | Taxa (%) | Divisor Reverso | Exemplo Bruto | Valor Original | Venda de Juros |
|:---:|:---:|:---:|---:|---:|---:|
| **1 a 4x** | **0,0%** | $\div 1,000$ | R$ 1.000,00 | R$ 1.000,00 | R$ 0,00 |
| **5x** | **10,5%** | $\div 1,105$ | R$ 1.105,00 | R$ 1.000,00 | R$ 105,00 |
| **6x** | **11,0%** | $\div 1,110$ | R$ 1.110,00 | R$ 1.000,00 | R$ 110,00 |
| **7x** | **11,5%** | $\div 1,115$ | R$ 1.115,00 | R$ 1.000,00 | R$ 115,00 |
| **8x** | **12,0%** | $\div 1,120$ | R$ 1.120,00 | R$ 1.000,00 | R$ 120,00 |
| **9x** | **12,5%** *(Confirmado)* | $\div 1,125$ | R$ 1.125,00 | R$ 1.000,00 | R$ 125,00 |
| **10x** | **13,0%** | $\div 1,130$ | R$ 1.130,00 | R$ 1.000,00 | R$ 130,00 |
| **11x** | **13,5%** *(Confirmado)* | $\div 1,135$ | R$ 1.135,00 | R$ 1.000,00 | R$ 135,00 |
| **12x** | **14,0%** | $\div 1,140$ | R$ 1.140,00 | R$ 1.000,00 | R$ 140,00 |
| **13x** | **14,5%** | $\div 1,145$ | R$ 1.145,00 | R$ 1.000,00 | R$ 145,00 |
| **14x** | **15,0%** | $\div 1,150$ | R$ 1.150,00 | R$ 1.000,00 | R$ 150,00 |
| **15x** | **15,5%** | $\div 1,155$ | R$ 1.155,00 | R$ 1.000,00 | R$ 155,00 |
| **16x** | **16,0%** | $\div 1,160$ | R$ 1.160,00 | R$ 1.000,00 | R$ 160,00 |
| **17x** | **17,5%** | $\div 1,175$ | R$ 1.175,00 | R$ 1.000,00 | R$ 175,00 |
| **18x** | **18,0%** | $\div 1,180$ | R$ 1.180,00 | R$ 1.000,00 | R$ 180,00 |

---

## 3. Estrutura Definitiva das Colunas (Integradas Dentro da Tabela)

Conforme instrução da diretoria, a tabela de cada loja terá exatamente **7 colunas integradas**:

$$\text{Tipo} \;\mid\; \text{Bandeira} \;\mid\; \text{Valor Bruto} \;\mid\; \text{Líquido Taxa} \;\mid\; \text{Venda de juros} \;\mid\; \text{Taxa} \;\mid\; \text{Juros}$$

### Definição de cada coluna:
1. **`Tipo`**: Modalidade da venda e número de parcelas (ex: `Crédito 11x`, `Crédito 2x`, `Débito`).
2. **`Bandeira`**: Bandeira do cartão (ex: `Mastercard`, `Visa`, `Elo`).
3. **`Valor Bruto`**: Valor total passado na máquina Rede (contém serviços/peças + juros repassados).
4. **`Líquido Taxa`**: Valor líquido a ser creditado pela Rede (após retenção das taxas da maquininha).
5. **`Venda de juros`**: Valor em R$ dos juros repassados ao cliente, calculado pela fórmula reversa ($\text{Valor Bruto} - \text{Valor Original}$).
6. **`Taxa`**: Taxa percentual da maquininha Rede (fórmula: `=(Líquido Taxa / Valor Bruto) - 1`, ex: `-10,57%`).
7. **`Juros`**: Valor em R$ descontado pela Rede (*substitui o antigo nome "Cobrado"*, fórmula: `Valor Bruto - Líquido Taxa`).

---

## 4. Grid de Pares de Lojas Lado a Lado (A4 Paisagem)

Para preservar o layout executivo de **duas lojas lado a lado**, o grid utilizará 15 colunas (`A` a `O`):

* **Loja Esquerda (Colunas A..G - 7 colunas):**
  * `A`: Tipo (largura ~9)
  * `B`: Bandeira (largura ~10)
  * `C`: Valor Bruto (largura ~12)
  * `D`: Líquido Taxa (largura ~12)
  * `E`: Venda de juros (largura ~12)
  * `F`: Taxa (largura ~8)
  * `G`: Juros (largura ~11)
* **Espaçador Central (Coluna H):** Largura ~2.5 (canaleta entre as lojas).
* **Loja Direita (Colunas I..O - 7 colunas):**
  * `I`: Tipo (largura ~9)
  * `J`: Bandeira (largura ~10)
  * `K`: Valor Bruto (largura ~12)
  * `L`: Líquido Taxa (largura ~12)
  * `M`: Venda de juros (largura ~12)
  * `N`: Taxa (largura ~8)
  * `O`: Juros (largura ~11)

---

## 5. Compactação Vertical de KPIs & Cabeçalho (Folha A4 Paisagem)

Para garantir que todas as 10 lojas caibam estritamente em **1 página física única** sem quebra de página:

1. **Banner Principal (Linha 1):** Altura reduzida de 26pt para **20pt** (fonte 10.5 bold).
2. **Subtítulo (Linha 2):** Altura reduzida de 18pt para **14pt** (fonte 8.5 regular).
3. **Espaçador Topo (Linha 3):** Altura reduzida de 8pt para **3pt**.
4. **Cards de KPIs Consolidados (Linhas 4 e 5) — 5 Cards cobrindo A..O:**
   * **Linha 4 (Labels):** Altura reduzida de 16pt para **12pt** (fonte 7.5 bold cinza escuro).
   * **Linha 5 (Valores):** Altura reduzida de 24pt para **17pt** (fonte 10.5 bold).
   * **Card 1 (Cols A..C):** `FATURAMENTO BRUTO REDE`
   * **Card 2 (Cols D..F):** `LÍQUIDO TOTAL CREDITADO`
   * **Card 3 (Cols G..I):** `TOTAL VENDA DE JUROS`
   * **Card 4 (Cols J..L):** `TAXAS / JUROS DA REDE`
   * **Card 5 (Cols M..O):** `SPREAD LÍQUIDO DA LOJA` (Venda Juros − Juros Rede)
5. **Espaçador Pós-KPIs (Linha 6):** Altura reduzida de 10pt para **4pt**.
6. **Espaçadores entre Pares de Lojas:** Altura reduzida de 12pt para **5pt**.
7. **Configuração de Impressão (PageSetup):**
   * `orientation: 'landscape'`
   * `paperSize: 9` (A4)
   * `fitToPage: true`
   * `fitToWidth: 1`
   * `fitToHeight: 1`
   * `margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 }`

*Ganho vertical total: **~45 pontos economizados**, eliminando o transbordo para a página 2.*

---

## 6. Próximo Passo (Ciclo SDD)

A proposta está fechada com a definição exata das 7 colunas solicitadas.  
O usuário pode revisar este documento e a planilha de demonstração atualizada e disparar `/sdd-apply` para consolidação no gerador oficial.
