# Proposal — Layout Delimitado por Loja e Impressão A4 Paisagem (Anti-Quebra)

**Spec ID:** `hydra-rede-layout-a4-delimited`  
**Data:** 06/10/2026  
**Contexto:** Automação do Relatório de Juros Rede (`projects/hydra-rede`)  
**Status:** PROPOSTA FORMALIZADA (Aguardando `/vibe-apply hydra-rede-layout-a4-delimited`)

---

## 1. Objetivo e Requisitos do Usuário

O usuário solicitou uma reformulação visual e estrutural da planilha gerada pelo bot com três requisitos mandatórios:

1. **Manter as transações agrupadas por loja (como no original):**  
   Cada uma das 10 lojas deve manter sua tabela própria e identificada com suas respectivas vendas (Tipo, Bandeira, Bruto, Líquido, Taxa, Cobrado), exatamente como na planilha histórica.
2. **Design delimitado, limpo e legível:**  
   Substituir a disposição visual confusa por blocos/tabelas claramente delimitados por bordas finas, cabeçalhos destacados com o nome da loja/EC, formatação monetária (`R$ #.##0,00`) e porcentagem (`0,00%`).  
   **Eliminação total dos erros `#DIV/0!`** nas linhas sem venda.
3. **Imprimir perfeitamente em folha A4 na Paisagem (Landscape):**  
   Ajustar a área de impressão (`!printArea`), margens e escala para que o relatório caiba em **1 folha A4 na orientação Paisagem** em dias normais, sem cortar colunas na lateral e sem esticar até a coluna 16.384 (`XFD`).
4. **Resiliência a variações extremas de transações (Anti-Quebra):**  
   Em dias de alto volume (como na segunda-feira, que consolida sexta, sábado e domingo), a planilha **NÃO PODE QUEBRAR**, sobrescrever outras lojas ou truncar/descartar vendas quando uma unidade tiver 20, 30 ou 40 transações.

---

## 2. Diagnóstico dos Problemas do Modelo Legado

A inspeção do arquivo manual e do template revelou os seguintes pontos de fragilidade:

1. **Disposição em 3 Colunas Paralelas Assimétricas:**  
   - Coluna 1 (B..G): Piraporinha (17 linhas), Mauá (17 linhas), JAB (apenas 7 linhas).
   - Coluna 2 (I..N): Planalto (17 linhas), Kennedy (17 linhas), DP (apenas 5 linhas).
   - Coluna 3 (P..U): Rudge (17 linhas), Santo André (17 linhas), RM (apenas 4 linhas), JB (apenas 4 linhas).
   - **Risco de Quebra:** A loja RM possui apenas 4 linhas disponíveis antes da linha de total e de outras lojas. Se RM tiver 6 vendas, o script original descartava as vendas 5 e 6 (`if (r >= start + clearRows) break;`), ou se inserisse linhas, empurraria e desalinharia as colunas 1 e 2!
2. **Range Desregulado (`A1:XFD69`):**  
   O arquivo original está com o range estendido até a coluna 16.384 (`XFD`). Ao abrir o diálogo de impressão, o Excel tenta imprimir milhares de colunas vazias ou reduz o zoom para escala microscópica ilegível.
3. **Erros `#DIV/0!` em Massa:**  
   A fórmula da taxa (`E/D-100%`) nas linhas vazias divide por zero, gerando dezenas de células vermelhas de erro `#DIV/0!` espalhadas pela planilha.
4. **Fórmulas de Soma em Posições Fixas:**  
   Totalizadores como `SUM(G58:G64)` para JAB ou `SUM(U59:U60, U53:U58)` para RM assumem intervalos rígidos. Qualquer variação de linhas quebra essas referências.

---

## 3. Solução Proposta

### 3.1. Arquitetura em Duas Abas Especializadas

Para atender 100% dos requisitos de leitura rápida, impressão A4 e integridade contábil, a planilha será entregue com:

#### Aba 1: "Relatório de Juros" (Aba Principal — Blocos por Loja Delimitados)
- **10 Blocos Modulares Independentes:**  
  Cada loja possui seu card/tabela delimitado com:
  - Cabeçalho estilizado: `[NOME DA LOJA] — EC XXXXXXXX`
  - Colunas padronizadas: `Tipo | Bandeira | Valor Bruto (R$) | Valor Líquido (R$) | Taxa (%) | Valor Cobrado (R$)`
  - Linhas de vendas individuais registradas em ordem.
  - Linha de Subtotal da Loja: `Total [Nome da Loja]: R$ Bruto | R$ Líquido | R$ Juros | % Efetiva`
- **Linhas Dinâmicas com Tratamento de Erro:**  
  Apenas linhas com vendas reais são renderizadas com cálculos. Linhas vazias são omitidas ou formatadas com `=SE.ERRO(E/D-100%; "-")`, garantindo zero `#DIV/0!`.
- **Área de Impressão A4 Paisagem:**  
  Configuração nativa de impressão no OpenXML:
  - `Orientation: Landscape` (Paisagem)
  - `PaperSize: 9` (A4)
  - `FitToWidth: 1` (Ajustar largura para 1 página)
  - `PrintArea: A1:U[fim]` (limita apenas as colunas reais com dados, sem XFD).
  - Margens estreitas (0,5 cm).

#### Aba 2: "Resumo Executivo" (Visão Geral Consolidada)
- Tabela compacta com as 10 lojas em linhas (1 a 10) + Total Geral + KPIs no topo.
- Imprime em **1 folha A4 Paisagem exata com 100% de garantia**, independente de haver 10 ou 500 transações no dia.

---

## 4. Garantia Anti-Quebra para Fins de Semana e Dias de Pico

Para que a planilha **nunca quebre** com qualquer variação de transações:

1. **Estrutura por Blocos Sequenciais (ou 2 Colunas com Altura Flexível):**  
   Em vez de sobrepor lojas verticalmente em posições fixas apertadas (como RM com apenas 4 linhas), cada loja é gerada com seu próprio bloco de tamanho adaptativo:
   - Se a loja tiver 0 vendas: renderiza 1 linha limpa com indicativo "Sem movimentação no dia" e total R$ 0,00.
   - Se a loja tiver 2 vendas: renderiza exatamente 2 linhas + linha de total.
   - Se a loja tiver 35 vendas no fim de semana: renderiza as 35 linhas + linha de total, sem colidir nem truncar.
2. **Totalizadores Dinâmicos:**  
   A fórmula de soma de cada loja utiliza o intervalo exato de suas transações (ex: `=SOMA(G8:G42)`), sem referências estáticas que quebram com inserção de dados.
3. **Total Geral Dinâmico:**  
   O Total Geral soma os subtotais de cada uma das 10 lojas.

---

## 5. Critérios de Sucesso e Validação

1. [ ] A planilha mantém cada loja em sua tabela delimitada e individual.
2. [ ] Zero ocorrências de `#DIV/0!` no arquivo gerado.
3. [ ] Todos os valores numéricos formatados em moeda (`R$ 1.050,00`) e porcentagem (`0,78%`).
4. [ ] Área de impressão configurada em A4 Paisagem sem extrapolação para colunas invisíveis.
5. [ ] Teste de estresse com volume simulado de fim de semana (50+ transações) confirmando que nenhuma venda é truncada.
6. [ ] Envio do arquivo gerado para conferência no WhatsApp `5511996242812`.
