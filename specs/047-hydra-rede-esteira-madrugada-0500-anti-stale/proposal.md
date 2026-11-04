# Proposta de Mudança — Spec 047: Hydra Rede Esteira Pós-Compensação das 05:00 AM, Eliminação de Stale Files Vespertinos e Proteção contra Taxas Arbitrárias

## 1. Problema e Diagnóstico Forense

Na apuração dos relatórios da Rede referentes ao dia 28/10/2026, foram constatadas duas inconsistências graves:
1. **Distorção em massa nos valores líquidos e taxas de juros:** Quase todas as transações de cartão de crédito e débito sofreram arredondamentos e divergências nos valores líquidos da planilha consolidada (ex: uma venda 12x teve o líquido distorcido em +R$ 109,82; o montante global divergiu em +R$ 266,84).
2. **Divergência de cobranças na loja Mauá:** Apareceram 2 transações (R$ 3.012,00 e R$ 2.025,40) que não constavam nas "cobranças fechadas" de ontem no ERP financeiro.

A auditoria técnica comprovou que **o robô não errou na leitura do Excel baixado**, mas sim foi vítima de uma **armadilha temporal na esteira de horários e reaproveitamento**:

### Causas-Raiz Identificadas:

1. **Janela de Compensação Noturna da Adquirente (Itaú / Rede):**
   - A câmara de liquidação contábil da Rede processa as taxas contratuais (MDR) e os valores líquidos das transações entre **00:00 e 03:30 da madrugada**.
   - Às 19:15 do mesmo dia (D-0), quando o script `run_evening_heartbeat.js` rodou na VPS, o lote de vendas ainda estava em aberto. O portal da Rede exportou todas as transações com `taxa MDR = '-'` e `valor líquido = '-'`.
2. **Fallback Arbitrário de Taxas no `excel_processor.js`:**
   - Diante do `valor líquido = '-'`, o código legado (linhas 242-253) aplicava alíquotas estáticas arbitrárias: 1,2% (débito), 2,5% (crédito à vista) e 4,7% (crédito parcelado), substituindo as taxas reais contratuais das lojas por estimativas genéricas que quebraram a contabilidade.
3. **Reaproveitamento Cego no Despacho Matinal (`run_unified_morning_dispatch.js`):**
   - O loop noturno das 23:52 teve a sessão desconectada pelo portal e travou por Google reCAPTCHA nas tentativas da madrugada.
   - Às 07:45 AM, o script matinal verificou apenas se `output/Juros Rede - 28-10-2026.xlsx` existia e era maior que 1KB. Como o arquivo das 19:24 da véspera estava lá, acionou o "Reaproveitamento Inteligente", cancelou a re-extração pós-clearing e disparou às 08:00 AM para o Financeiro a planilha intradiária com taxas falsificadas.
4. **Vazamento de Pré-Autorizações de OS em Aberto (Mauá):**
   - A transação de R$ 3.012,00 foi um link de pagamento pré-autorizado (`status: parcelado sem juros pre-auto`, `pré-autorizado: sim`) e a de R$ 2.025,40 foi passada no terminal de Mauá para a OS #22654, que ainda continua em atendimento físico no pátio (`is_aberta: 1`). Para o financeiro, essas OSs não constavam em faturamento fechado do caixa de ontem.

---

## 2. Solução Arquitetural Proposta

### 2.1 Reestruturação Temporal Soberana: Ancoragem às 05:00 AM
- O ciclo de extração definitivo de Juros Rede do dia D-1 passa a ter como **âncora oficial as 05:00:00 AM** (pós-fechamento bancário Itaú/Rede que encerra às 03:30 AM).
- Às 05:00 AM, 100% das transações de ontem (D-1) já foram compensadas, e os campos `taxa MDR` e `valor líquido` vêm 100% calculados e gravados centavo a centavo pela Rede.

### 2.2 Isolamento Total do Heartbeat Vespertino das 19:15
- `run_evening_heartbeat.js` passa a operar estritamente como **Session Healthcheck & Probe** (verificando se o portal Meu Rede está logado e alertando o Dev antes da meia-noite se houver reCAPTCHA).
- Se gerar prévia, o arquivo deve ser gravado com sufixo `_previa_intradiaria.xlsx`, sendo **terminantemente proibido** criar ou sobrescrever o arquivo canônico `output/Juros Rede - DD-MM-AAAA.xlsx`.

### 2.3 Mtime Guard Pós-Meia-Noite no Despacho Matinal
- `run_unified_morning_dispatch.js` passa a validar a "idade" do arquivo `Juros Rede - DD-MM-AAAA.xlsx`:
  - Regra estrita: `mtime >= 00:00:00 da data atual (D0)`.
  - Qualquer arquivo com data de modificação anterior à meia-noite é descartado como `STALE_INTRADAY` e força a extração completa e limpa da madrugada.

### 2.4 Remoção de Alíquotas Arbitrárias e Auditoria de Pré-Autorizações
- No `excel_processor.js`, se o relatório for processado em D+1 e contiver `valor líquido === '-'`, o sistema não deve arbitrar alíquotas de 4,7%, mas sim sinalizar a transação como pendência de liquidação bancária.
- Identificação e separação de transações com `pré-autorizado: sim` para que não contaminem a conferência de vendas faturadas.

---

## 3. Critérios de Aceite
- [ ] O arquivo oficial `Juros Rede - DD-MM-AAAA.xlsx` NUNCA é gerado ou sobrescrito por rotinas intradiárias anteriores à meia-noite.
- [ ] O despacho matinal (`run_unified_morning_dispatch.js`) rejeita compulsoriamente qualquer arquivo com `mtime` anterior às 00:00:00 do dia do despacho.
- [ ] O cron da VPS e os orquestradores priorizam a extração das 05:00 AM, pós-compensação da Rede/Itaú.
- [ ] Eliminação de alíquotas arbitrárias fictícias (1.2%, 2.5%, 4.7%) em `excel_processor.js`.
- [ ] Identificação clara de transações pré-autorizadas / não compensadas.
- [ ] Todos os testes automatizados da suíte (`npm test` / `run_all_tests.js`) passam com 100% de sucesso.
- [ ] Crontab da VPS e scripts sincronizados e validados via SSH.
