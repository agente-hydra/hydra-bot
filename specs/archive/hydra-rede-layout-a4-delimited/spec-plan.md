# Plano de Implementação — Layout Delimitado por Loja & Impressão A4 Paisagem

**Spec ID:** `hydra-rede-layout-a4-delimited`  
**Data:** 06/10/2026  
**Status:** CONCLUÍDO E APLICADO (Aguardando `/vibe-archive hydra-rede-layout-a4-delimited`)

---

## 1. Fases e Checklist de Execução

### Fase 1: Motor de Renderização de Blocos Delimitados por Loja
- [x] **[BLOCK-ENGINE]** Implementada em `src/excel_processor.js` a função `gerarPlanilhaDelimitadaA4` com renderização das 10 lojas em cards delimitados por bordas e cabeçalhos escuros corporativos (`[NOME DA LOJA] — EC XXXXX`).
- [x] **[DYNAMIC-ROWS]** Dimensionamento dinâmico e elástico de linhas por loja (`blockDataRows = Math.max(leftRows, rightRows)`), impedindo sobreposição vertical e garantindo integridade mesmo em fins de semana com dezenas de vendas.
- [x] **[SUBTOTALS]** Fórmulas de subtotal por loja (`=SUM(...)`) apontando dinamicamente para o intervalo exato de transações de cada unidade.

---

### Fase 2: Eliminação de Erros e Formatação Visual
- [x] **[NO-DIV0]** Fórmulas de taxa protegidas com `=IF(C>0, (D/C)-1, 0)`, eliminando 100% dos erros `#DIV/0!` nas linhas sem transação.
- [x] **[NUMBER-FORMATS]** Máscaras nativas de moeda (`"R$" #,##0.00;("R$" #,##0.00);"-"`), porcentagem (`0.00%;-0.00%;"-"`) e inteiros (`#,##0`).
- [x] **[EMPTY-STATES]** Lojas sem movimentação no dia renderizam uma linha limpa: `Sem movimentação no dia` com totais R$ 0,00 e taxa 0.00%, sem poluição visual.

---

### Fase 3: Configuração Nativa de Impressão em A4 Paisagem
- [x] **[PAGE-SETUP]** Configuração OpenXML aplicada via ExcelJS:
  - `orientation: 'landscape'` (Paisagem)
  - `paperSize: 9` (Papel A4)
  - `fitToWidth: 1` (Ajustar largura para 1 folha A4)
  - `fitToHeight: 0` (Altura elástica natural)
- [x] **[PRINT-AREA]** `printArea` calibrada estritamente para `A1:M36` na Aba 1 e `A1:H15` na Aba 2, eliminando a antiga referência para a coluna 16.384 (`XFD`).
- [x] **[MARGINS]** Margens estreitas (0,4" laterais, 0,5" verticais) garantindo máxima legibilidade.

---

### Fase 4: Aba de Resumo Executivo
- [x] **[DASHBOARD-TAB]** Criada a Aba 2 "Resumo Executivo" contendo tabela compacta das 10 lojas (10 linhas) com totais consolidados e indicadores principais, travada em 1 folha A4 Paisagem física (`fitToWidth: 1, fitToHeight: 1`).
- [x] **[CLASSIC-TAB]** Preservada a Aba 3 "Layout Clássico" com o formato legado de 3 colunas saneado sem `#DIV/0!`.

---

### Fase 5: Teste de Validação e Estresse Anti-Quebra
- [x] **[STRESS-TEST]** Teste de estresse sintético executado com 187 transações assimétricas (até 60 vendas em RM e 45 em JAB), comprovando expansão elástica sem nenhuma colisão de blocos ou perda de dados.
- [x] **[VERIFY-E2E]** Validação exata com dados reais de ontem (`05/10/2026`):
  - Bruto Total: **R$ 22.207,71** (100% idêntico)
  - Líquido Total: **R$ 20.899,31** (100% idêntico)
  - Juros Retidos: **R$ 1.308,40** (100% idêntico)
  - Transações: **11 transações**
  - Erros `#DIV/0!`: **0**

---

### Fase 6: Entrega e Validação no WhatsApp
- [x] **[WA-DELIVER]** Arquivo oficial `JUROS REDE - 2026-10-05.xlsx` entregue com sucesso via WhatsApp para `5511996242812` (Davi) com a legenda executiva.
- [x] **[USER-AUDIT]** Cópia disponibilizada em `C:\Users\User\Downloads\JUROS REDE_A4_DELIMITADO.xlsx` para conferência direta no computador.

---

## 2. Ponto de Interrupção Obrigatório (Hard Stop)

Conforme as regras do ciclo SDD (`ia.md`, `sdd-apply.md`):
- A implementação está 100% concluída e testada.
- O build gate e os testes sintéticos e reais passaram com sucesso.
- O arquivo foi enviado via WhatsApp e salvo localmente para inspeção do usuário.
- O agente aguarda a validação do usuário antes de qualquer commit ou arquivamento (`/vibe-archive`).
