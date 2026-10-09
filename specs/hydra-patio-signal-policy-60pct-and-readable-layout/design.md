# Design Técnico: Sinal Crítico (< 60% pago e Pendência ≥ R$ 2.600) & Layout Limpo WhatsApp

**Spec ID:** `hydra-patio-signal-policy-60pct-and-readable-layout`  
**Data:** 09/10/2026  
**Status:** Design Técnico Atualizado (SDD Design)  

---

## 1. Contratos TypeScript em `src/hydra-sync/whatsapp_formatter.ts`

```typescript
export interface VeiculoSinalCritico {
  osId: string | number;
  veiculo: string;
  placa?: string;
  totalOs: number;
  valorPago: number;
  saldoRestante: number;
  percentualPago: number; // Ex: 47.6
  falta60: number;        // MAX(0, (totalOs * 0.60) - valorPago)
}

export interface LojaSinalCritico {
  loja: string;
  slug: string;
  totalValorRestante: number;
  totalQtd: number;
  veiculos: VeiculoSinalCritico[];
}

export interface DadosBlocoSinalCritico {
  totalQtd: number;
  totalValorRestante: number;
  totalLojas: number;
  lojas: LojaSinalCritico[];
}
```

---

## 2. Implementação do Helper em `whatsapp_patio_dispatcher.js`

```javascript
function carregarCarrosCriticosSinal(pisoPendente = 2600, metaSinalPct = 0.60) {
  const dbPath = process.env.HYDRA_DB_PATH || '/home/operacional/hydra-data/hydra_ops.db';
  if (!Database || !fs.existsSync(dbPath)) {
    return { totalQtd: 0, totalValorRestante: 0, totalLojas: 0, lojas: [] };
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT 
      os_id,
      loja_slug,
      veiculo,
      placa,
      total_os,
      valor_pago,
      valor_restante,
      ROUND((valor_pago * 100.0) / total_os, 1) as pct_pago,
      ROUND(MAX(0, (total_os * ? ) - valor_pago), 2) as falta_60
    FROM ordens_servico 
    WHERE is_aberta = 1 
      AND total_os > 0
      AND valor_pago < (total_os * ?) 
      AND valor_restante >= ? 
    ORDER BY valor_restante DESC
  `).all(metaSinalPct, metaSinalPct, pisoPendente);
  db.close();

  const lojasMap = {};
  let totalValorRestante = 0;

  for (const r of rows) {
    const cs = matchStore(r.loja_slug);
    const nomeLoja = cs ? cs.displayName : r.loja_slug;
    if (!lojasMap[nomeLoja]) {
      lojasMap[nomeLoja] = {
        loja: nomeLoja,
        slug: r.loja_slug,
        totalValorRestante: 0,
        totalQtd: 0,
        veiculos: []
      };
    }
    lojasMap[nomeLoja].totalValorRestante += (r.valor_restante || 0);
    lojasMap[nomeLoja].totalQtd += 1;
    lojasMap[nomeLoja].veiculos.push({
      osId: r.os_id,
      veiculo: r.veiculo || 'Veículo',
      placa: r.placa,
      totalOs: r.total_os,
      valorPago: r.valor_pago,
      saldoRestante: r.valor_restante,
      percentualPago: r.pct_pago,
      falta60: r.falta_60
    });
    totalValorRestante += (r.valor_restante || 0);
  }

  const lojas = Object.values(lojasMap);
  // Ordena lojas pela maior pendência acumulada
  lojas.sort((a, b) => b.totalValorRestante - a.totalValorRestante);

  return {
    totalQtd: rows.length,
    totalValorRestante,
    totalLojas: lojas.length,
    lojas
  };
}
```

---

## 3. Formatação no `buildExecutiveSummaryText`

```javascript
  // 3. Carros críticos sem sinal de 60% (Pendência >= R$ 2.600)
  const criticos = carregarCarrosCriticosSinal(2600, 0.60);
  if (criticos && criticos.lojas && criticos.lojas.length > 0) {
    const cabecalho = [
      `*Carros críticos sem sinal de 60%*`,
      `- Saldo em risco (pendência ≥ R$ 2.600): *${formatBRL(criticos.totalValorRestante)}* (${criticos.totalQtd} ordens em ${criticos.totalLojas} lojas)`
    ];

    const lojasBlocos = [];
    criticos.lojas.forEach((l, idx) => {
      const linhas = [`${idx + 1}. *${l.loja}*`];
      l.veiculos.forEach(v => {
        linhas.push(`- ${v.veiculo} (OS #${v.osId}): *${formatBRL(v.saldoRestante)}* pendente (${v.percentualPago}% pago)`);
      });
      lojasBlocos.push(linhas.join('\n'));
    });

    blocos.push(cabecalho.join('\n') + '\n\n' + lojasBlocos.join('\n\n'));
  }
```

---

## 4. Testes e Validação
1. Teste unitário em `test_whatsapp_patio.js` verificando os 6 veículos esperados e ausência de pipes.
2. Disparo de validação isolado com `test_dispatch_validation_phone.js` para `5511996242812`.
