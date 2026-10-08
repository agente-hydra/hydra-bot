# Proposta de Arquitetura: Pagamentos Estritos D-1 & Total Consolidado do Saldo de Pátio

**Spec ID:** `hydra-patio-strict-payments-and-grand-total`  
**Data:** 08/10/2026  
**Status:** PROPOSTA / AGUARDANDO REVISÃO  

---

## 1. Problema Diagnosticado

Durante a validação com os dados reais de hoje (referência 07/10/2026), identificou-se que as OSs **22631, 22626, 22601 (Mauá), 8834 (Rudge Ramos) e 464 (Jabaquara)** trouxeram pagamentos antigos ou parcelas futuras na coluna `PAGAMENTOS:`, distorcendo o relatório com pagamentos que não ocorreram ontem.

### Causa Raiz Técnica:
No arquivo [`src/patio_ledger_engine.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/patio_ledger_engine.js#L138-L146), a função `isPaymentOnReferenceDay` continha a seguinte heurística:
```javascript
// Heurística com defeito:
if (isCredito && docUpdBR === refDateBR) {
  const vDate = parseBRToDateObj(vencimentoBR);
  const rDate = parseBRToDateObj(refDateBR);
  if (vDate >= rDate) return true;
}
```
**O erro conceitual:** O campo `historico_atualizado_em` do ERP não é uma data de pagamento — ele é atualizado sempre que qualquer usuário edita a OS (ex: troca de status, adição de foto/anexo, checklist ou peça). Quando alguém editou a OS 22601 em 07/10/2026 às 11:34, o bot presumiu que todas as 20 parcelas de crédito com vencimento futuro (R$ 14.061,72) foram passadas ontem!

Além disso, a planilha gerada na **Aba "OS"** possuía subtotais individuais por loja, mas **não apresentava o Total Geral Consolidado do Saldo de Pátio Ativo da Rede**, obrigando a navegação até a segunda aba.

---

## 2. Solução Proposta

### A. Filtro Estrito Temporal de Pagamento (Zero Falsos Positivos)
- Eliminar completamente a heurística de `historico_atualizado_em` para detecção de pagamentos.
- Um pagamento pertence a ontem (D-1) **SE E SOMENTE SE** sua data de vencimento/liquidação for **exatamente igual ao dia de referência D-1** (`vencimentoBR === refDateBR`).
- Com essa correção determinística:
  - OS 22631, 22626, 22601, 8834, 464 exibirão `—` na coluna de pagamentos (ou a tag `[Finalizada em DD/MM]` caso tenham finalizado no dia), com destaque azul desativado.
  - OS 8836, 8832, 8829, 4437, 4439, 40409, 40411, 40413, 40414, 1915, 1917, 1130, 22635 (14 pagamentos legítimos de ontem) permanecem destacados.
  - Total recebido em D-1 corrigido de R$ 54.498,38 (inflado) para **R$ 16.451,06** (real).

### B. Exibição do Total do Saldo do Pátio na Planilha
1. **Card KPI Executivo no Topo da Aba "OS" (Linhas 4 e 5):**
   - Bloco visível logo na abertura da planilha sem necessidade de scroll:
     - `B4:C5`: **VEÍCULOS NO PÁTIO ATIVO:** `29 ordens`
     - `D4:D5`: **SALDO TOTAL DO PÁTIO:** `R$ 39.889,65` (Fundo Âmbar/Gold 100 `#FEF3C7`, Borda `#F59E0B`, Fonte 12 bold `#78350F`)
     - `E4:E5`: **RECEBIMENTOS DE ONTEM:** `R$ 16.451,06` (Fundo Azul 100 `#E0F2FE`, Borda `#7DD3FC`, Fonte 12 bold `#0369A1`)
2. **Linha de Fechamento Consolidado no Rodapé da Aba "OS":**
   - Após a 10ª unidade (Jabaquara), linha de **TOTAL CONSOLIDADO REDE** com fórmula dinâmica `=SUM(...)` somando os subtotais das 10 lojas em formato contábil oficial.

---

## 3. Contratos de Dados & Impactos

- **`patio_ledger_engine.js`:**
  - `isPaymentOnReferenceDay(payment, refDateBR)`: simplificada para validação estrita de data.
- **`excel_patio_builder.js`:**
  - Adição do Card KPI de Topo e da linha Grand Total de Rede na Aba "OS".
- **`whatsapp_patio_dispatcher.js`:**
  - Totais de pagamentos atualizados automaticamente pelo motor sem vazamento de histórico.
- **Ambiente de Execução:**
  - Sincronização direta na VPS Linux (`/home/operacional/hydra-rede/`).

---

## 4. Risco Principal & Mitigação

| Risco | Severidade | Mitigação |
|---|---|---|
| Cartão parcelado ter apenas parcelas futuras no ERP | Baixa | Apenas parcelas com vencimento D-1 são contabilizadas como caixa do dia, atendendo estritamente ao requisito da diretoria ("mostrar somente os pagamentos novos do dia anterior"). |
