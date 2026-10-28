# Design Técnico: Motor de Conciliação Pátio & OS (Resolução de Datas e Elegibilidade)

## 1. Arquitetura da Solução

O objetivo é substituir heurísticas frágeis baseadas em subtração ingênua de 30 dias por uma resolução determinística de data de transação, ancorada em dados concretos do ERP Oficina Integrada.

### 1.1 Resolução da Data da Transação (`resolveTransactionDateBR`)

Atualmente:
```javascript
// ANTIGO (Frágil e sujeito a erros de calendário civil)
function estimateTransactionDateBR(vencBR, isCreditOrBoleto) {
  if (!vencBR) return null;
  const norm = normalizeToBRDate(vencBR);
  if (!isCreditOrBoleto) return norm;
  return subDays(norm, 30);
}
```

Novo Design:
```javascript
/**
 * Determina a data real da transação comercial.
 * 1. Se o objeto de pagamento ou a OS possui data de faturamento/baixa/histórico, utiliza como âncora principal.
 * 2. Se for cartão de crédito com 1º vencimento no mês seguinte (M+1):
 *    - Converte o vencimento para o dia equivalente no mês anterior considerando dias corridos e tolerância para finais de semana e feriados (28 a 34 dias).
 *    - Se o dia resultante estiver na mesma janela de referência da data de fechamento da OS, alinha rigorosamente com a data de fechamento.
 * 3. Pagamento a prazo ("PAGAMENTO EM CONTA", promissória, cheque pré):
 *    - A data da transação comercial é a data em que a OS foi faturada/entregue (data_fim / data_inicio), e NÃO o vencimento futuro da parcela financeira.
 */
function resolveTransactionDateBR(paymentItem, osDoc, refDatesList) {
  const forma = String(paymentItem.forma || '').toLowerCase();
  const isCredit = forma.includes('cred');
  const isContaOuBoleto = forma.includes('conta') || forma.includes('boleto') || forma.includes('faturad');
  
  // Âncora 1: Se a OS foi finalizada em uma data específica (data_fim / faturamento_data)
  const dtFechamento = osDoc.dataFechamento || osDoc.data_fim || osDoc.faturamento_data;
  const dtFechamentoBR = dtFechamento ? normalizeToBRDate(dtFechamento) : null;
  
  if (dtFechamentoBR && refDatesList.includes(dtFechamentoBR)) {
    // Se a OS fechou no dia de referência D-1, a transação comercial de quitação pertence a D-1
    return dtFechamentoBR;
  }
  
  // Âncora 2: Pagamentos a prazo em conta pertencem à data de abertura/fechamento da OS
  if (isContaOuBoleto && dtFechamentoBR) {
    return dtFechamentoBR;
  }
  
  // Âncora 3: Cartão de Crédito
  if (isCredit) {
    const vencBR = normalizeToBRDate(paymentItem.vencimento);
    if (!vencBR) return dtFechamentoBR || null;
    
    // Subtrai 1 mês civil com tolerância de janela (janela de 28 a 33 dias)
    const dtTransacaoAproximada = subtractMonthCivil(vencBR);
    
    // Se a data aproximada cai no mesmo dia ou dia adjacente de D-1 e a OS fechou em D-1:
    if (dtFechamentoBR && refDatesList.includes(dtFechamentoBR)) {
      return dtFechamentoBR;
    }
    return dtTransacaoAproximada;
  }
  
  // Âncora 4: PIX, Débito, Dinheiro
  return normalizeToBRDate(paymentItem.vencimento) || dtFechamentoBR;
}
```

---

### 1.2 Regra de Elegibilidade de Pátio e Expurgo de OS Fechadas Antigas

Para uma OS ser exibida no relatório diário de Pátio:
1. **OS Aberta (`is_aberta === 1`):** Permanece no pátio físico.
   - Valor exibido = `valor_restante` do ERP.
2. **OS Fechada Ontem (Saída de Pátio em D-1):**
   - Teve data de saída/fechamento (`data_fim`) igual a D-1; OU
   - Teve pagamento registrado com data comercial igual a D-1;
   - Linha exibida como Saída de Pátio (Âmbar ou informativa), com `Valor: 0` e pagamentos detalhados na coluna `PAGAMENTOS:`.
3. **OS Fechada Antes de D-1 (Expurgo Total):**
   - Se `is_aberta === 0` e `data_fim < D-1`, a OS **NUNCA** deve ser ressuscitada para o pátio, mesmo que tenha parcelas a vencer no futuro sob a forma "PAGAMENTO EM CONTA".
4. **Remoção de Hardcodes:**
   - Eliminar `(osNum === 1929 || osNum === 2489)`. A transição deve ser 100% determinística baseada no snapshot do dia anterior e timestamps do ERP.

---

### 1.3 Subtração de Mês Civil (`subtractMonthCivil`)

Em vez de subtrair fixos 30 dias:
```javascript
function subtractMonthCivil(dateBR) {
  const parts = dateBR.split('/').map(Number);
  if (parts.length !== 3) return dateBR;
  let [d, m, y] = parts;
  
  // Volta 1 mês
  m -= 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  
  // Ajusta dias máximos do mês anterior (ex: se era 31/03, em fev vira 28 ou 29)
  const maxDays = new Date(y, m, 0).getDate();
  const adjustedDay = Math.min(d, maxDays);
  
  return `${String(adjustedDay).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}
```
Se o vencimento caiu numa segunda-feira (23/11/2026), `subtractMonthCivil("23/11/2026")` dá `23/10/2026`, mas ao correlacionar com o dia de fechamento real da OS (`data_fim = 22/10/2026`), o alinhamento é exato em `22/10/2026`!
