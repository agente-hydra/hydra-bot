# Proposta de Correção: Divergência na Conciliação de Pátio x Rede (23/10/2026)

## 1. Sumário Executivo
No dia 23/10/2026, a conciliação automática gerada pelo robô (`Conciliacao Patio x Rede - 23-10-2026.xlsx`) divergiu significativamente da conciliação manual elaborada pela equipe financeira (`CONCILIAÇÃO 2310.xlsx`):
- **Crédito Recebido no Pátio (D-1):** O robô reportou **R$ 0,00**, enquanto o manual e a própria Adquirente REDE registraram **R$ 23.323,07** em vendas de cartão.
- **Saldo Pendente no Pátio:** O robô totalizou **R$ 95.981,52** (61 OSs), enquanto o fechamento manual consolidado na aba `SALDO` totalizou **R$ 70.059,48** e a soma bruta da aba `OS` totalizou **R$ 82.468,74**.
- **OSs Inexistentes no Pátio Manual:** O robô ressuscitou 7 OSs já fechadas e entregues em dias anteriores (OSs 18519, 2489, 1903, 1925, 1929, 1936, 1937), somando **R$ 8.627,24** de saldo fantasma.

A auditoria em código e logs provou que **NÃO foi um caso isolado de falha de conexão/banco**, mas sim um **bug sistêmico de lógica temporal no motor de cálculo do pátio (`patio_ledger_engine.js`)**, desencadeado por uma colisão matemática de calendário civil (fim de semana) com a função de estimativa de data de transações de crédito e parcelamentos futuros.

---

## 2. Diagnóstico Técnico Detalhado (Causa Raiz)

### Causa Raiz 1: A Falha Matemática em `estimateTransactionDateBR` (subDays 30 fixo)
- **Localização:** `/home/operacional/hydra-rede/src/patio_ledger_engine.js` (linhas 175-180)
- **Código Atual:**
  ```javascript
  function estimateTransactionDateBR(vencBR, isCreditOrBoleto) {
    if (!vencBR) return null;
    const norm = normalizeToBRDate(vencBR);
    if (!isCreditOrBoleto) return norm;
    return subDays(norm, 30);
  }
  ```
- **Mecanismo da Falha em 22/10/2026:**
  1. A rotina do dia 23/10 avalia o dia de referência **D-1 = 22/10/2026**.
  2. As vendas de cartão de crédito realizadas em 22/10/2026 tiveram sua 1ª parcela lançada pelo ERP Oficina Integrada para 1 mês depois: 22/11/2026.
  3. No calendário civil de 2026, **22/11/2026 é Domingo**.
  4. O sistema ERP joga automaticamente o vencimento de domingo para o primeiro dia útil subsequente: **23/11/2026 (Segunda-feira)**.
  5. A função do robô executa: `subDays("23/11/2026", 30)`.
  6. Como Outubro tem 31 dias e o vencimento foi deslocado para segunda, `23/11/2026 - 30 dias` resultou em: **24/10/2026**!
  7. O robô comparou a data estimada (`24/10/2026`) com a data avaliada (`22/10/2026`):
     - `isDateAfter("24/10/2026", "22/10/2026") === true`.
  8. Conclusão errônea do robô: *"Esta transação de cartão ocorreu no futuro (após D-1)!"*
  9. **Efeito em cascata:**
     - 100% dos cartões de crédito do dia 22/10 foram ignorados no pátio (`Crédito ontem = R$ 0,00`).
     - A coluna `PAGAMENTOS:` das OSs no pátio recebeu `—` (vazio).

---

### Causa Raiz 2: A Reanimação Indevida de OSs Fechadas (`isClosedOnDayD`)
- **Localização:** `/home/operacional/hydra-rede/src/patio_ledger_engine.js` (linhas 305-330)
- **Código Atual:**
  ```javascript
  const isClosedOnDayD = !isAbertaNow && (
    hasPaymentInDayD ||
    (dataFechamentoBR && isDateAfter(dataFechamentoBR, lastRefDateBR)) ||
    (dataSaidaBR && isDateAfter(dataSaidaBR, lastRefDateBR)) ||
    (historicoBR && isDateAfter(historicoBR, lastRefDateBR) && !tevePagamentoOntem && (wasOpenYesterday || rec.ultimaDataAbertaPatio === refDateBR)) ||
    (osNum === 1929 || osNum === 2489)
  );

  if (isClosedOnDayD) {
    isAbertaD1 = true;
    saldoPendenteD1 = rec.valorTotal || ...;
  ```
- **Mecanismo da Falha:**
  1. Ao calcular que as vendas de crédito tinham data estimada em 24/10 (futuro), o robô setou `hasPaymentInDayD = true`.
  2. Como `hasPaymentInDayD` ficou `true`, as OSs que foram pagas e fechadas em 22/10 (ex: Planalto 18530 R$ 1.839,60, Rudge 8861 R$ 1.119,30, Mauá 22653 R$ 979,40, etc.) foram interpretadas como se tivessem sido pagas "no dia seguinte".
  3. O robô reativou essas OSs como abertas (`isAbertaD1 = true`) e restaurou o saldo total como pendente (`saldoPendenteD1 = rec.valorTotal`).
  4. Além disso, clientes que pagaram na modalidade `"PAGAMENTO EM CONTA"` com boleto/prazo futuro (ex: vencimento em 26/10, 28/10, 12/11): como a forma não continha a string `cred`, a função retornou a data do vencimento futuro como data da transação, acionando `hasPaymentInDayD = true` e ressuscitando OSs encerradas semanas antes (OSs 18519, 1903, 1925, 1936, 1937).

---

### Causa Raiz 3: Hardcodes de OSs Específicas
- **Localização:** `/home/operacional/hydra-rede/src/patio_ledger_engine.js` (linha 323)
- `(osNum === 1929 || osNum === 2489)` foi deixado chumbado no código de produção para resolver uma anomalia de um dia específico (21/10) e forçou essas duas OSs a reaparecerem no pátio indefinidamente.

---

### Causa Raiz 4: Erro de Digitação Humano no Gabarito Manual
- Na planilha manual (`CONCILIAÇÃO 2310.xlsx`):
  - Na OS 1919 (Rei do Módulo), o operador digitou **R$ 1.090,00**, enquanto no ERP Oficina Integrada a OS é de apenas **R$ 190,00** (um laudo técnico de garantia sem peças). Diferença de R$ 900,00 a favor do bot.
  - Na OS 1940 (Rei do Módulo), o manual registrou `-18.40`, enquanto no ERP a OS foi finalizada zerada.

---

## 3. Escopo da Solução Proposta
1. **Refatorar `estimateTransactionDateBR` para Usar Timestamp Real do ERP:**
   - Em vez de tentar "adivinhar" a data da venda subtraindo 30 dias fixos do primeiro vencimento, verificar primariamente a data real do faturamento/baixa: `doc.faturamento_data`, `doc.data_fim`, `doc.historico_atualizado_em` ou data da transação na adquirente.
   - Caso precise estimar via vencimento, aplicar tolerância mensal inteligente baseada no dia do mês civil (calendário com dias úteis), e nunca descartar uma transação de crédito se ela constar no extrato da Rede do mesmo dia.
2. **Revisar a Regra `isClosedOnDayD` e Expurgo de Contas a Prazo:**
   - Transações com modalidade `"PAGAMENTO EM CONTA"` com vencimento futuro NÃO são pagamentos realizados no Dia D; são parcelamentos acordados no passado cuja OS já foi faturada e entregue.
   - Remover os hardcodes `osNum === 1929 || osNum === 2489`.
3. **Harmonizar a Coluna "Valor:" com a Visão Financeira:**
   - Manter a regra contábil clara: se a OS foi paga e baixada no dia de referência, o saldo pendente restante é 0 (e deve ser somado no total recebido de D-1).
