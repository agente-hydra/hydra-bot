# Proposta: Contas a Vencer Hoje x Entradas de Ontem no Balão 2

**Spec ID:** `hydra-daily-financial-cashflow-balance`  
**Data:** 09/10/2026  
**Status:** Proposta Atualizada (SDD Proposal - Ajuste de Escopo)  

---

## 1. Problema e Diretriz do Usuário

### 1.1. Solicitação do Usuário
> *"nao asssim nao carai, usa no balao 2 de faturamento e cmv pr ainculir contas e vendidos "ontem" ou quqe vai cair sla, pr acolocar por loja e o total mais ou menos, e colcoacr as contas que vamos pagar hoje, perao tem qeu ser de hj, ent o qeu exporta ccontas se der pra exportara a contas a vencer A VENCER do dia atual (pq ele puxa do anterior)"*

### 1.2. Decisão Arquitetural e de Negócio
1. **Balão 1 (`HYDRA | Operação`) permanece 100% OPERACIONAL:**
   - Contém apenas Pátio Ativo, Movimentação de OSs e os 6 Carros Críticos sem sinal de 60% ($\ge$ R$ 2.600).
   - Sem poluição com tabelas ou contas a pagar.
2. **Balão 2 (`HYDRA | Faturamento & CMV`) assume a Reconciliação Financeira Diária:**
   - Faturamento acumulado no mês + CMV% por loja.
   - **Entradas de ontem (vendidos ontem / o que cai hoje):** valor recebido por loja e na rede.
   - **Contas a pagar HOJE (contas a vencer no dia atual):** compromissos que a diretoria precisa pagar hoje!
   - **Saldo do dia:** confronto loja a loja e total da rede com status visual claro:
     - `🟢 +R$ X (Positivo)`
     - `🔴 -R$ Y (No Vermelho)`
3. **Ajuste na Exportação de Contas a Pagar do ERP:**
   - O crawler atual filtrava "Data de Pagamento" (opção `'3'`) com datas de ontem ($D-1$).
   - O crawler passa a exportar **"Data de Vencimento" (opção `'2'`)** com a data de **HOJE ($D$)**!
   - Captura todas as **Contas a Vencer no Dia Atual** para alimentar o relatório matinal das 08:00 AM.

---

## 2. Evidência Real Extraída do ERP ($D = 09/10/2026$)

Teste realizado diretamente no ERP Oficina Inteligente autenticado na VPS Linux:
- **Total de lançamentos a vencer hoje:** **33 contas**.
- **Valor total a vencer hoje na rede:** **R$ 73.164,10** (R$ 57.094,00 desmarcando Master).
- **Distribuição por Loja das Contas a Pagar Hoje ($D = 09/10$):**
  - Dom Pedro I: R$ 13.050,99
  - Rei do Módulo: R$ 9.270,29
  - Piraporinha: R$ 8.961,20
  - Rudge Ramos: R$ 7.228,39
  - Jabaquara: R$ 5.545,33
  - Jorge Beretta: R$ 4.863,17
  - Planalto: R$ 3.386,36
  - Santo André: R$ 3.199,27
  - Mauá: R$ 820,73
  - Kennedy: R$ 768,27
  *(Master: R$ 16.070,10)*

- **Entradas / Vendidos de Ontem ($D-1 = 08/10$):**
  - Total geral da rede: **R$ 40.717,50** (Imediato Pix + Débito: **R$ 12.095,50**).
  - Planalto: R$ 12.800,90
  - Santo André: R$ 9.901,20
  - Piraporinha: R$ 6.491,90
  - Dom Pedro I: R$ 4.341,50
  - Jabaquara: R$ 3.448,00
  - Kennedy: R$ 1.854,00
  - Jorge Beretta: R$ 1.000,00
  - Mauá: R$ 770,00
  - Rudge Ramos: R$ 110,00
  - Rei do Módulo: R$ 0,00

---

## 3. Prévia dos 2 Balões no WhatsApp

### Balão 1 (`HYDRA | Operação`) — Limpo & Operacional:
```text
*HYDRA | Operação*

08/10/2026 · Pátio & OS (D-1)

*Pátio ativo*
- Veículos no pátio ativo: *31* ordens
- Saldo total pendente: *R$ 38.321,35*
- Saídas de pátio ontem: *22* ordens finalizadas

*Carros críticos sem sinal de 60%*
- Saldo em risco (pendência ≥ R$ 2.600): *R$ 26.130,20* (6 ordens em 5 lojas)

1. *Rudge Ramos*
- FOCUS (OS #8803): *R$ 6.394,60* pendente (48% pago)

2. *Jorge Beretta*
- MERIVA (OS #1131): *R$ 5.234,70* pendente (16% pago)

3. *Rei do Módulo*
- ECOSPORT XLT (OS #1818): *R$ 4.420,90* pendente (53% pago)
- FUSCA NOVO (OS #1856): *R$ 4.000,00* pendente (0% pago)

4. *Piraporinha*
- COBALT (OS #40410): *R$ 3.480,00* pendente (54% pago)

5. *Jabaquara*
- KA SE (OS #465): *R$ 2.600,00* pendente (0% pago)
```

### Balão 2 (`HYDRA | Faturamento, CMV & Contas do Dia`):
```text
*HYDRA | Faturamento, CMV & Contas do Dia*

09/10/2026 · Posição Mês & Previsão Hoje

*Desempenho por unidade*

1. *Planalto*
- Faturamento Mês: *R$ 45.716,90* | CMV: *N/D*
- Entrou ontem: *R$ 12.800,90* | A pagar hoje: *R$ 3.386,36*
- Saldo previsto: *+R$ 9.414,54* 🟢 (Positivo)

2. *Santo André*
- Faturamento Mês: *R$ 35.148,00* | CMV: *N/D*
- Entrou ontem: *R$ 9.901,20* | A pagar hoje: *R$ 3.199,27*
- Saldo previsto: *+R$ 6.701,93* 🟢 (Positivo)

3. *Kennedy*
- Faturamento Mês: *R$ 10.193,91* | CMV: *N/D*
- Entrou ontem: *R$ 1.854,00* | A pagar hoje: *R$ 768,27*
- Saldo previsto: *+R$ 1.085,73* 🟢 (Positivo)

4. *Mauá*
- Faturamento Mês: *R$ 38.154,73* | CMV: *N/D*
- Entrou ontem: *R$ 770,00* | A pagar hoje: *R$ 820,73*
- Saldo previsto: *-R$ 50,73* 🔴 (No vermelho)

5. *Jabaquara*
- Faturamento Mês: *R$ 35.541,90* | CMV: *20,4%*
- Entrou ontem: *R$ 3.448,00* | A pagar hoje: *R$ 5.545,33*
- Saldo previsto: *-R$ 2.097,33* 🔴 (No vermelho)

6. *Piraporinha*
- Faturamento Mês: *R$ 34.430,32* | CMV: *N/D*
- Entrou ontem: *R$ 6.491,90* | A pagar hoje: *R$ 8.961,20*
- Saldo previsto: *-R$ 2.469,30* 🔴 (No vermelho)

7. *Jorge Beretta*
- Faturamento Mês: *R$ 14.486,30* | CMV: *N/D*
- Entrou ontem: *R$ 1.000,00* | A pagar hoje: *R$ 4.863,17*
- Saldo previsto: *-R$ 3.863,17* 🔴 (No vermelho)

8. *Rudge Ramos*
- Faturamento Mês: *R$ 53.260,94* | CMV: *N/D*
- Entrou ontem: *R$ 110,00* | A pagar hoje: *R$ 7.228,39*
- Saldo previsto: *-R$ 7.118,39* 🔴 (No vermelho)

9. *Dom Pedro I*
- Faturamento Mês: *R$ 11.228,02* | CMV: *N/D*
- Entrou ontem: *R$ 4.341,50* | A pagar hoje: *R$ 13.050,99*
- Saldo previsto: *-R$ 8.709,49* 🔴 (No vermelho)

10. *Rei do Módulo*
- Faturamento Mês: *R$ 32.527,00* | CMV: *N/D*
- Entrou ontem: *R$ 0,00* | A pagar hoje: *R$ 9.270,29*
- Saldo previsto: *-R$ 9.270,29* 🔴 (No vermelho)

*Consolidado da rede*
- Faturamento acumulado no mês: *R$ 310.688,01*
- CMV médio da rede: *20,4%*
- Entradas de ontem: *R$ 40.717,50* (Imediato: R$ 12.095,50)
- Contas a pagar hoje: *R$ 57.094,00*
- Saldo previsto hoje: *-R$ 16.376,50* 🔴 (No vermelho)

> Maior superávit de hoje: *Planalto* (+R$ 9.414,54).
> Maior compromisso a pagar hoje: *Dom Pedro I* (R$ 13.050,99).
> Maior CMV da rede: *Jabaquara* (20,4%).
> Menor faturamento no mês: *Kennedy* (R$ 10.193,91).
```
