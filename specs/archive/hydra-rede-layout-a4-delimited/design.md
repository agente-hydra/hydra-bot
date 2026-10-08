# Design Técnico — Layout Delimitado por Loja & Impressão A4 Paisagem

**Spec ID:** `hydra-rede-layout-a4-delimited`  
**Data:** 06/10/2026  
**Status:** ESPECIFICAÇÃO DE DESIGN TÉCNICO

---

## 1. Arquitetura Geral do Documento Excel

O novo documento Excel será gerado dinamicamente pelo `src/excel_processor.js`, combinando as transações reais extraídas do portal Meu Rede com uma camada de formatação e diagramação profissional:

```
+-----------------------------------------------------------------------------------------+
|                        JUROS REDE - YYYY-MM-DD.xlsx                                     |
+-----------------------------------------------------------------------------------------+
| ABA 1: "Relatório de Juros" (Principal)                                                 |
|   +-----------------------------------------------------------------------------------+ |
|   | CABEÇALHO DO RELATÓRIO: Relatório Diário de Juros e Conciliação Rede — DD/MM/AAAA | |
|   | INDICADORES CONSOLIDADOS: Total Bruto | Total Líquido | Juros Cobrados | % Médio  | |
|   +-----------------------------------------------------------------------------------+ |
|                                                                                         |
|   +-- [BLOCO 1: PIRAPORINHA] ----------------+  +-- [BLOCO 2: PLANALTO] ------------+  |
|   | Tipo | Bandeira | Bruto | Líquido | Taxa |  | Tipo | Bandeira | Bruto | Líquido |.. |  |
|   | déb  | Master   | 1050  | 1041.81 | 0.78%|  | déb  | Master   | 819.7 | 813.31  |.. |  |
|   | TOTAL PIRAPORINHA: R$ 8,19               |  | TOTAL PLANALTO: R$ 6,39           |  |
|   +------------------------------------------+  +-----------------------------------+  |
|                                                                                         |
|   +-- [BLOCO 3: RUDGE] ----------------------+  +-- [BLOCO 4: MAUÁ] ----------------+  |
|   | Tipo | Bandeira | Bruto | Líquido | Taxa |  | Tipo | Bandeira | Bruto | Líquido |.. |  |
|   | créd | Visa     | 1000  | 948.60  | 5.14%|  | créd | Master   | 3910  | 3709.03 |.. |  |
|   | déb  | Visa     | 366.6 | 363.74  | 0.78%|  | créd | Master   | 800   | 758.88  |.. |  |
|   | créd | Visa     | 2157.7| 2046.79 | 5.14%|  | TOTAL MAUÁ: R$ 242,09             |  |
|   | cr12 | Visa     | 2415.6| 2163.90 | 10.4%|  +-----------------------------------+  |
|   | TOTAL RUDGE: R$ 416,88                   |                                         |
|   +------------------------------------------+  +-- [BLOCO 6: SANTO ANDRÉ] ---------+  |
|                                                 | (Sem movimentação de cartão no dia)|  |
|   ... (Blocos delimitados para as 10 lojas)     | TOTAL SANTO ANDRÉ: R$ 0,00        |  |
|                                                 +-----------------------------------+  |
|   +-----------------------------------------------------------------------------------+ |
|   | TOTAL GERAL DA REDE (10 Lojas): R$ 22.207,71 (Bruto) | R$ 1.308,40 (Juros)        | |
|   +-----------------------------------------------------------------------------------+ |
|                                                                                         |
|   * CONFIGURAÇÃO DE IMPRESSÃO: A4 Paisagem, FitToWidth: 1, Margens 0,5cm, PrintArea    |
+-----------------------------------------------------------------------------------------+
| ABA 2: "Resumo Executivo"                                                               |
|   Tabela compacta 10 linhas (1 por loja) + KPIs + 1 folha A4 Paisagem garantida.        |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Especificação dos Blocos Delimitados por Loja

Para conciliar a preferência do usuário (transações por loja em caixas/blocos próprios) com a exigência de impressão em A4 na Paisagem e segurança contra overflow:

### 2.1. Estrutura das Colunas por Bloco
Cada bloco de loja possui 6 colunas canônicas:
1. **Tipo:** Modalidade padronizada (`débito`, `crédito`, ou `crédito 12`).
2. **Bandeira:** `Visa`, `Mastercard`, `Elo`, etc.
3. **Valor Bruto:** Valor original da venda formatado como moeda (`R$ #,##0.00`).
4. **Valor Líquido:** Valor creditado formatado como moeda (`R$ #,##0.00`).
5. **Taxa (%):** Fórmula `=SE.ERRO(E/D-100%; "-")` formatada como porcentagem com 2 casas (`0.00%`).
6. **Valor Cobrado:** Fórmula `=SE(D=""; 0; D-E)` formatada como moeda (`R$ #,##0.00`).

### 2.2. Cabeçalho e Rodapé de Cada Bloco
- **Título do Bloco:** Linha mesclada destacada com cor de fundo neutra/elegante (cinza executivo ou azul corporativo suave), texto em negrito:  
  `LOJA: [NOME_PLANILHA] | EC: [NUMERO_EC]`
- **Linha de Totais da Loja:**  
  Fórmula de subtotal somando apenas as linhas daquela loja:
  - Total Bruto: `=SOMA(Bruto_Inicio:Bruto_Fim)`
  - Total Líquido: `=SOMA(Liquido_Inicio:Liquido_Fim)`
  - Total Juros: `=SOMA(Cobrado_Inicio:Cobrado_Fim)`
  - % Efetivo da Loja: `=SE.ERRO(Total_Cobrado/Total_Bruto; 0%)`

---

## 3. Mecanismo Dinâmico Anti-Quebra (Capacidade Elástica)

O maior risco do modelo legado era a sobreposição vertical rígida (ex: RM tinha apenas 4 linhas antes de JAB).

### Solução Técnica no Gerador:
1. **Layout em 2 Colunas de Blocos (5 Lojas na Esquerda / 5 Lojas na Direita) ou Sequencial:**
   - Coluna Esquerda: Piraporinha, Planalto, Rudge, Mauá, Kennedy
   - Coluna Direita: Santo André, JAB, DP, JB, RM
2. **Dimensionamento Elástico:**
   - Em vez de travar linhas em índices estáticos (como linha 53 para RM), o motor calcula dinamicamente o deslocamento vertical (`offset`):
     - Para cada loja, reserva o número exato de linhas necessárias para as transações existentes + 1 linha de cabeçalho + 1 linha de subtotal + 1 linha de respiro.
     - Caso a loja tenha 0 vendas, renderiza apenas 1 linha limpa com o aviso: `Sem movimentação no dia`.
     - Caso uma loja tenha 50 vendas em um fim de semana, o bloco aloca as 50 linhas, calcula o subtotal logo abaixo e posiciona a próxima loja a partir da linha seguinte, **sem nunca sobrescrever ou descartar nenhuma venda**.
3. **Referências de Fórmulas Relativas:**
   - As fórmulas de soma de cada loja são geradas dinamicamente apontando para o intervalo exato de suas linhas (ex: `=SOMA(D8:D14)` se a loja teve 7 vendas, ou `=SOMA(D8:D38)` se teve 30 vendas).
   - O Total Geral no rodapé soma as células de totais das 10 lojas: `=D20+D35+D60+...`.

---

## 4. Configuração de Impressão em A4 Paisagem (Landscape)

Para garantir que o documento seja impresso perfeitamente em papel A4 na horizontal sem cortes:

### 4.1. Propriedades OpenXML / SheetJS
```javascript
ws['!pageSetup'] = {
  orientation: 'landscape',  // Orientação Paisagem
  paperSize: 9,              // 9 = Papel A4 (297mm x 210mm)
  fitToWidth: 1,             // Ajustar colunas para 1 página de largura
  fitToHeight: 0,            // Altura livre (ou 1 se couber em uma página)
  scale: 100                 // Escala base
};

ws['!margins'] = {
  left: 0.4,                 // Margens estreitas (0,4 polegadas ~ 1 cm)
  right: 0.4,
  top: 0.5,
  bottom: 0.5,
  header: 0.3,
  footer: 0.3
};
```

### 4.2. Correção Crítica da Área de Impressão (`!printArea` e `!ref`)
- O modelo antigo possuía `!ref: A1:XFD69` (16.384 colunas).
- O novo motor ajusta estritamente:
  ```javascript
  ws['!ref'] = `A1:${lastColumn}${lastRow}`;
  ws['!printArea'] = `A1:${lastColumn}${lastRow}`;
  ```
  Isso elimina qualquer tentativa do Excel de imprimir colunas vazias ou comprimir a folha até a ilegibilidade.

---

## 5. Eliminação de Erros `#DIV/0!` e Formatação

1. **Fórmula Segura da Taxa:**
   Em vez de `E7/D7-100%`, a fórmula será escrita como:
   `=IF(D7>0; E7/D7-1; "-")` (ou `=SE(D7>0; E7/D7-1; "-")`)
   Se não houver venda na linha, a taxa não divide por zero e não exibe `#DIV/0!`.
2. **Formatação Numérica Nativa (`numFmt`):**
   - Bruto / Líquido / Juros: `"R$"\\ #,##0.00;("R$"\\ #,##0.00);"-"`
   - Taxa (%): `0.00%;-0.00%;"-"`
   - Zeros exibidos como traço limpo (`-`) em vez de poluição visual.

---

## 6. Módulos a Modificar

1. **`src/excel_processor.js`:**
   - Adicionar o gerador elástico de blocos delimitados (`gerarPlanilhaDelimitadaA4`).
   - Implementar cálculo dinâmico de intervalos de fórmulas e totalizadores.
   - Configurar propriedades de página OpenXML (A4 Paisagem, margens estreitas, área de impressão).
2. **`src/scraper.js`:**
   - Chamar o novo gerador passando a lista de transações individuais por loja.
3. **`template/JUROS REDE.xlsx`:**
   - Preservar como referência e atualizar com o novo layout mestre delimitado.
