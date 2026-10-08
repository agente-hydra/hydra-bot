# Proposta: Reconciliação Diária de Pátio D-1 & Algoritmo Estrito de Movimentações

**Spec ID:** `hydra-patio-d1-reconciliation`  
**Data:** 07/10/2026  
**Status:** PROPOSTA / EM REVISÃO (SDD Hard Stop)  
**Autor:** Antigravity Pair-Programming com Usuário  

---

## 1. O Problema Real Diagnosticado

No relatório gerado anteriormente, ocorreram distorções contábeis e de apresentação:
1. **Poluição com Ordens Antigas de Setembro:**  
   O relatório listou mais de uma dúzia de OSs abertas em setembro e já encerradas ou abandonadas no sistema, ofuscando as OSs reais do mês corrente (outubro).
2. **Vazamento de Pagamentos Históricos na Coluna de Pagamentos:**  
   A coluna `PAGAMENTOS:` exibia o somatório de todos os pagamentos da vida da OS (incluindo PIX e cartões quitados há semanas), aparentando erroneamente que foram recebidos de ontem para hoje.
3. **Falso Fechamento ("Quitada Hoje"):**  
   O ledger anterior inferia que qualquer OS ausente do grid ou com saldo zero havia sido liquidada no dia da execução, inflando os recebimentos diários com OSs que já estavam concluídas no passado.
4. **Descompasso entre Situação Operacional e Recebimento:**  
   Não havia distinção entre *receber pagamento no dia* e *fechar a OS no pátio*. Um veículo que recebeu sinal/quitação ontem pode continuar aberto no pátio físico (ex: no elevador ou em teste de rodagem) com saldo R$ 0,00.

---

## 2. A Nova Lógica Algorítmica (Modelo Oficial D-1)

A regra de negócio canônica estabelecida com o usuário define:

> **O relatório de conciliação executado no dia $D$ avalia as movimentações do dia de referência $D-1$ ("ontem"). Ele deve exibir EXCLUSIVAMENTE todas as OSs em aberto no pátio E as OSs que foram fechadas ontem ($D-1$). Os pagamentos exibidos na coluna referem-se APENAS aos incluídos ontem, enquanto o saldo pendente considera todos os pagamentos acumulados (inclusive os antigos).**

### Pilares da Lógica:

1. **Critério de Elegibilidade (Quem entra no relatório):**
   - **OS está em aberto no pátio?** (`is_aberta === 1`) $\rightarrow$ **SIM, entra sempre** (independentemente de quando entrou no pátio).
   - **OS não está em aberto (`is_aberta === 0`):**
     - **Foi fechada ontem ($D-1$)?** $\rightarrow$ **SIM, entra** (com saldo zerado e os pagamentos de ontem).
     - **Foi fechada antes de ontem ($< D-1$)?** $\rightarrow$ ⛔ **NÃO ENTRA!** Expurgada completamente do relatório.
2. **Coluna `Valor:` (Saldo Pendente Acumulado):**
   - Reflete o saldo devedor real remanescente:  
     $$\text{Saldo Pendente} = \text{Valor Total da OS} - \sum (\text{Todos os Pagamentos Históricos})$$
   - Uma OS pode estar **ABERTA** com saldo devedor de **R$ 0,00** (ex: cliente pagou tudo ontem, mas o veículo ainda está na oficina aguardando liberação técnica ou retirada).
3. **Coluna `PAGAMENTOS:` (Apenas Movimentação de Ontem):**
   - Exibe **SOMENTE** os pagamentos recebidos no dia de referência ($D-1$).
   - Pagamentos ocorridos em dias anteriores abatem o saldo acumulado na coluna `Valor:`, mas **NÃO** aparecem na coluna `PAGAMENTOS:`.
   - Se a OS não recebeu nenhum pagamento em $D-1$, exibe `—`.
4. **Destaque Visual (🔵 / Accent):**
   - O indicador visual significa estritamente: **"Recebeu pagamento ontem ($D-1$)"**.
   - **Independência Total:** Não significa que a OS foi fechada. Ela pode continuar aberta com saldo, aberta com saldo zerado, ou ter sido fechada ontem.
5. **Bloco de Totais e Conciliação Executiva:**
   - **Recebimentos de ontem discriminados por forma:** Crédito, Débito, PIX, Dinheiro, etc.
   - **Saldo total pendente na rede:** Soma aritmética dos saldos em aberto de todos os veículos no pátio.

---

## 3. Exemplo Prático de Validação

Considerando execução em **07/10/2026** com dia de referência **06/10/2026**:

| OS | Data de Entrada | Situação no Pátio | Data Fechamento | Pagamentos em 06/10 ($D-1$) | Saldo Pendente (`Valor:`) | Destaque |
|---|---|---|---|---|---:|:---:|
| **18508** | 06/10/26 | Aberta | — | — | R$ 1.556,40 | — |
| **18507** | 06/10/26 | Aberta | — | — | R$ 1.200,00 | — |
| **18506** | 06/10/26 | **Aberta** | — | 🔵 Crédito: R$ 2.560,00 | **R$ 0,00** | 🔵 |
| **18503** | 02/10/26 | Aberta | — | — | R$ 2.723,10 | — |
| **2020** | 01/10/26 | Aberta | — | 🔵 Pix: R$ 300,00 | R$ 500,00 | 🔵 |
| **18509** | 07/10/26 | Fechada ontem | 06/10/26 | 🔵 Dinheiro: R$ 900,00 | R$ 0,00 | 🔵 |
| *OS 1700* | *15/09/26* | *Fechada em 18/09* | *18/09/26* | *Descartada* | *—* | *FORA* |

*(Exemplo da OS 2020: Total R$ 1.000,00. Pago R$ 200,00 em 03/10 e R$ 300,00 em 06/10. Em 06/10 mostra apenas PIX: R$ 300,00, e saldo remanescente R$ 500,00).*

---

## 4. Impacto na Arquitetura e Código

1. **`patio_ledger_engine.js` (Motor Contábil):**
   - Substituição da lógica de ciclo mensal indiscriminado por motor com data de corte $D-1$.
   - Função de elegibilidade: `(isAberta === 1) || (dataFechamento === D_minus_1)`.
   - Separação entre `saldoPendenteAcumulado` e `pagamentosDoDiaRef`.
2. **`patio_hydra_bot_adapter.js` (Adaptador do Hydra Bot):**
   - Extração precisa da data de fechamento / última atualização (`faturamento_data`, `data_fim` ou `historico_atualizado_em`).
   - Identificação de pagamentos recebidos na data de referência $D-1$ por data da transação / vencimento / diff diário de pagamentos.
3. **`excel_patio_builder.js` (Planilha Oficial):**
   - Aplicação de preenchimento azul suave (`#E0F2FE`) e ícone `🔵` nas linhas que receberam pagamento em $D-1$.
   - Exibição de `—` na coluna `PAGAMENTOS:` quando não houve pagamento ontem.
   - Adição do bloco resumo com recebimentos de ontem por modalidade e saldo pendente total.
4. **`whatsapp_patio_dispatcher.js`:**
   - Mensagem executiva informando:
     - Total recebido ontem por forma de pagamento.
     - Total do pátio pendente na rede.
     - Planilha anexada pronta para conciliação.

---

## 5. Próximos Passos (Ciclo SDD)

Aguardar comando explícito `/sdd-apply` para iniciar a implementação cirúrgica das etapas mapeadas em `spec-plan.md`.
