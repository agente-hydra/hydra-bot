# Plano de Execução: Implementação de 7 Colunas Integradas & Compactação A4

**Spec ID:** `hydra-rede-venda-juros`  
**Status:** PROPOSTA ATUALIZADA / AGUARDANDO COMANDO APPLY  

---

## Checklist de Tarefas

- [x] **1. [ALGO] Tabela de Fatores e Cálculo Reverso (`excel_processor.js`)**
  - [x] Implementar matriz `TABELA_REPASSE` com as 18 faixas oficiais (confirmadas: 9x = 12,5% e 11x = 13,5%).
  - [x] Implementar função `calcularVendaJuros(valorBruto, parcelas)` retornando `{ taxa, divisor, valorOriginal, vendaJuros }`.

- [x] **2. [LAYOUT] Estrutura Definitiva de 7 Colunas Integradas por Loja**
  - [x] Cabeçalho das colunas em cada card: `Tipo` | `Bandeira` | `Valor Bruto` | `Líquido Taxa` | `Venda de juros` | `Taxa` | `Juros`.
  - [x] Renomear definitivamente a coluna `Cobrado` para `Juros` com fórmula `=Bruto - Líquido Taxa`.
  - [x] Preencher a coluna `Venda de juros` com o valor calculado dos juros repassados ao cliente.
  - [x] Configurar pares de lojas lado a lado: Loja Esquerda (A..G), Canaleta (H), Loja Direita (I..O).

- [x] **3. [A4 COMPACT] Orçamento Vertical Compactado para Impressão A4 Paisagem**
  - [x] Ajustar Banner Principal para altura 20pt (fonte 10.5 bold).
  - [x] Ajustar Subtítulo para altura 14pt (fonte 8.5 regular).
  - [x] Reduzir espaçadores de topo e entre seções para 3pt a 5pt.
  - [x] Compactar cards de KPIs no topo: altura de labels para 12pt (fonte 7.5 bold) e valores para 17pt (fonte 10.5 bold).
  - [x] Distribuir os 5 cards de KPIs cobrindo uniformemente o grid de colunas A..O.
  - [x] Configurar PageSetup estrito: `fitToWidth: 1`, `fitToHeight: 1`, `orientation: 'landscape'`, margens `0.3 pol`.

- [x] **4. [WHATSAPP] Atualização do Despachante (`index.js` / `whatsapp_notifier.js`)**
  - [x] Integrar indicadores no texto corporativo: Faturamento Bruto, Líquido Creditado, Total Venda de Juros, Juros Retidos pela Rede e Spread.

- [x] **5. [TEST & BUILD] Validação Automatizada**
  - [x] Executar build de teste com dados reais/mockados.
  - [x] Validar integridade matemática das 7 colunas e subtotais.
  - [x] Verificar visualmente o enquadramento em 1 folha A4 paisagem única.

---

## Circuit Breaker (SDD Hard Stop)
**PARE.** Proposta e Design atualizados com as 7 colunas exatas. Aguardando o comando `/sdd-apply` do usuário para iniciar a implementação.
