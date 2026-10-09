# Design Técnico: Mapeamento Total 360° da OS (9 Abas) e Conciliação no Crawler Hydra

**Spec ID:** `hydra-crawler-payment-tab-and-closure-reconciliation`  
**Data:** 09/10/2026  
**Status:** DESIGN TÉCNICO ATUALIZADO (SDD)  

---

## 1. Fluxo de Navegação e Extração 360° no Playwright

```
                    [ Abrir OS no Popup ]
                   (wfOrdemDeServico.aspx)
                              │
                              ▼
        ┌───────────────────────────────────────────┐
        │   Ciclo de Ativação Sequencial das 9 Abas │
        │   (Disparo dos Eventos AJAX WebForms)     │
        └─────────────────────┬─────────────────────┘
                              │
  ┌───────────────────────────┼───────────────────────────┐
  ▼                           ▼                           ▼
1. Produtos e Serviços      4. Documentos               7. Check-List
   - ucOrdemDeServicoItem_grd  - ucOrdemDeServicoDoc_grd   - grdCheckList
   - Totais e Descontos        - Links e origens           - Hodômetro e progresso
  ▼                           ▼                           ▼
2. Buscar Produtos e Serv.  5. Notas                    8. Garantia(s)
   - Catálogo/Itens vinculados - ucOrdemDeServicoFiscal_grd - grdOperacaoEstoque
  ▼                           ▼                           ▼
3. Pagamentos               6. Agendamento(s)           9. Histórico
   - ucOrdemDeServicoPag_grd   - ucPlacaAgenda_grd         - Criado em/por
   - Vencimentos / PIX         - ucPlacaAlerta_grd         - Atualizado em/por
   - txtTotalValor / txtRestante
                              │
                              ▼
            ┌───────────────────────────────────┐
            │   Extração Consolidada no DOM     │
            │   (Header 360° + 9 Abas Mapeadas) │
            └─────────────────┬─────────────────┘
                              │
                              ▼
    [ Salvar raw_payload 360° + Colunas Estruturadas no SQLite ]
```

---

## 2. Detalhamento dos Módulos

### 2.1 Mapeador das 9 Abas em `os_deep_inspector.ts`

Criar função auxiliar `ativarTodasAsAbas(detailPage: Page)`:
```typescript
const SELETORES_ABAS = [
  { nome: 'Produtos e Serviços',        selector: 'a:has-text("Produtos e Serviços"), span:has-text("Produtos e Serviços"), [id*="tapItem"]' },
  { nome: 'Buscar Produtos e Serviços', selector: 'a:has-text("Buscar Produtos"), span:has-text("Buscar Produtos"), [id*="tapBuscar"]' },
  { nome: 'Pagamentos',                 selector: 'a:has-text("Pagamentos"), span:has-text("Pagamentos"), [id*="tapPagamento"]' },
  { nome: 'Documentos',                 selector: 'a:has-text("Documentos"), span:has-text("Documentos"), [id*="tapDocumento"]' },
  { nome: 'Notas',                      selector: 'a:has-text("Notas"), span:has-text("Notas"), [id*="tapFiscal"]' },
  { nome: 'Agendamento(s)',             selector: 'a:has-text("Agendamento"), span:has-text("Agendamento"), [id*="tapAgenda"]' },
  { nome: 'Check-List',                 selector: 'a:has-text("Check-List"), span:has-text("Check-List"), [id*="tapCheckList"]' },
  { nome: 'Garantia(s)',                selector: 'a:has-text("Garantia"), span:has-text("Garantia"), [id*="tapGarantia"]' },
  { nome: 'Histórico',                  selector: 'a:has-text("Histórico"), span:has-text("Histórico"), [id*="tapHistorico"]' },
];

export async function ativarTodasAsAbas(detailPage: Page): Promise<void> {
  for (const aba of SELETORES_ABAS) {
    try {
      const loc = detailPage.locator(aba.selector).first();
      if (await loc.isVisible({ timeout: 1200 }).catch(() => false)) {
        await loc.click().catch(() => {});
        await detailPage.waitForTimeout(350);
      }
    } catch {}
  }
}
```

### 2.2 Extração Completa no DOM (`extrairDetalheDaPagina`)

1. **Cabeçalho Global:**
   - `empresa`: `#ctl00_cph_ddlEmpresa option:checked`
   - `codigo_os`: `getVal('#ctl00_cph_txtOrdemDeServicoID, span[id*="lblCodigo"]')`
   - `faturamento_data`: `getVal('#ctl00_cph_txtDataFaturamento')`
   - `data_inicio`: `input[id*="txtDataInicio"]` ou regex `\bIn[íi]cio\s+([0-3]?\d\/[0-1]?\d\/\d{4}(?:\s+[0-2]?\d:[0-5]\d)?)`
   - `data_fim`: `input[id*="txtDataFim"]` ou regex `\bFim\s+([0-3]?\d\/[0-1]?\d\/\d{4}(?:\s+[0-2]?\d:[0-5]\d)?)`
   - `veiculo`: `getVal('#ctl00_cph_txtVeiculo, span[id*="lblVeiculo"]')`
   - `placa`: `getVal('#ctl00_cph_txtPlaca, span[id*="lblPlaca"]')`
   - `hodometro`: `getVal('#ctl00_cph_txtHodometro')`
   - `ano`: `getVal('#ctl00_cph_txtAno')`
   - `cliente_nome`: `getVal('#ctl00_cph_txtCliente, span[id*="lblCliente"]')`
   - `cliente_cpf`: `getVal('input[id*="txtCPF"]')`
   - `cliente_telefones`: extração de todos os telefones no bloco do cliente (`(11) 99121-2956`, etc.)
   - `responsavel`: `getVal('#ctl00_cph_txtResponsavel, span[id*="lblResponsavel"]')`
   - `observacao`: `getVal('#ctl00_cph_txtObservacao')`
   - `credito`: `getVal('input[id*="Credito"], #ctl00_cph_txtCredito')`
   - `is_bloqueada_fechada`: `/fechada\s+e\s+bloqueada/i.test(bodyText)`

2. **Aba 1 — Produtos e Serviços:**
   - Grid: `table[id*="ucOrdemDeServicoItem_grd"] tr`
   - Campos: `codigo`, `referencia`, `descricao`, `qtd`, `valor_unitario`, `valor_total`, `executor`.
   - Totais: `total_os` (ou soma dos itens), `desconto_pct`, `total_produtos_pct`, `total_servicos_pct`.

3. **Aba 2 — Buscar Produtos e Serviços:**
   - Grid de catálogo/itens em busca e configurações de precificação ativas.

4. **Aba 3 — Pagamentos:**
   - Grid: `table[id*="ucOrdemDeServicoPagamento_grd"] tr`
   - Campos: `parcela`, `vencimento`, `forma`, `valor`, `num_operacao`, `enviado_financeiro`.
   - Totais: `valor_pago` (`txtTotalValor` ou soma das parcelas), `valor_restante` (`txtRestante` ou saldo matemático).

5. **Aba 4 — Documentos:**
   - Grid: `table[id*="ucOrdemDeServicoDocumento_grd"] tr`
   - Campos: `origem`, `data`, `descricao`, `opcao`.

6. **Aba 5 — Notas:**
   - Grid: `table[id*="ucOrdemDeServicoFiscal_grd"] tr`
   - Campos: Número da NF, Chave, Emissão, Valor, Status.

7. **Aba 6 — Agendamento(s):**
   - Grid Agendamentos: `table[id*="ucPlacaDoVeiculoAgenda_grd"] tr` (`data_hora`, `lembrete`, `funcionario`).
   - Grid Alertas Preventiva: `table[id*="ucPlacaDoVeiculoAlerta_grd"] tr` (`data_alerta`, `tipo_alerta`).

8. **Aba 7 — Check-List:**
   - Grid: `table[id*="ucOrdemDeServicoCheckList_grdCheckList"] tr`
   - Campos: `codigo`, `data`, `tipo`, `realizado_por`, `status`, `hodometro`, `progresso`, `termino`.

9. **Aba 8 — Garantia(s):**
   - Grid: `table[id*="ucOrdemDeServicoOperacaoEstoque_grdOperacaoEstoque"] tr`
   - Campos: `operacao`, `hodometro`, `entrada_estoque`, `descricao`.

10. **Aba 9 — Histórico:**
    - Campos: `historico_criado_em`, `historico_criado_por`, `historico_atualizado_em`, `historico_atualizado_por`.

---

### 2.3 Decisão de Transição Nominal em `deep-crawler.ts`

Ao checar uma OS em `TRANSICAO_PENDENTE`:
```typescript
const isFechada = 
  Boolean(detalhe.is_bloqueada_fechada) ||
  statusGeral.includes('FECHAD') || 
  statusGeral.includes('FATUR') || 
  Boolean(detalhe.data_fim) || 
  Boolean((detalhe as any).faturamento_data) ||
  (detalhe.total_os !== undefined && detalhe.valor_pago !== undefined && detalhe.valor_pago >= detalhe.total_os && detalhe.valor_restante === 0);

if (isFechada) {
  formalizarTransicaoNominalOS(db, p.os_id, slug, 'ENCERRADA', 'VALIDACAO_NOMINAL_FECHADA', detalhe);
} else if (isCancelada) {
  formalizarTransicaoNominalOS(db, p.os_id, slug, 'CANCELADA', 'VALIDACAO_NOMINAL_CANCELADA', detalhe);
} else if (detalhe.extracao_completa && statusGeral.includes('ABERT') && !detalhe.is_bloqueada_fechada) {
  formalizarTransicaoNominalOS(db, p.os_id, slug, 'ABERTA', 'VALIDACAO_NOMINAL_ABERTA', detalhe);
} else {
  // Inconclusivo — mantém em TRANSICAO_PENDENTE sem reabertura indevida
}
```

---

### 2.4 Persistência Financeira e Payload em `db_repository.ts`

Ajustar `formalizarTransicaoNominalOS` para:
- Atualizar `total_os`, `valor_pago`, `valor_restante`.
- Atualizar `data_fim` e `data_fim_iso`.
- Atualizar `raw_payload` com o JSON 360° completo de 9 abas.

---

### 2.5 Script de Reconciliação do Banco SQLite (`hydra_ops.db`)

Executar no banco operacional:
- Correção imediata da OS #1856 (Rei do Módulo):
  - `is_aberta = 0`, `estado_operacional = 'ENCERRADA'`, `total_os = 4000.00`, `valor_pago = 4000.00`, `valor_restante = 0.00`, `data_fim = '30/09/2026 13:17'`.
- Auditoria de integridade em ordens da rede com saldo restante zero ou marcas de encerramento.
