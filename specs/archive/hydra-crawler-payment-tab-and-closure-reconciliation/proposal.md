# Proposta SDD: Mapeamento Total 360° da OS (9 Abas) e Conciliação no Crawler Hydra

**Spec ID:** `hydra-crawler-payment-tab-and-closure-reconciliation`  
**Data:** 09/10/2026  
**Status:** PROPOSTA ATUALIZADA (SDD Proposal)  
**Autor:** Antigravity (Single-Agent Headless)  

---

## 1. Problema e Diagnóstico Factual

O usuário reportou discrepância operacional crítica no relatório diário de pátio:
O veículo **FUSCA NOVO (OS #1856 - Rei do Módulo)** apareceu como:
`- FUSCA NOVO (OS #1856): *R$ 4.000,00* pendente (0% pago)`

Porém, na tela real do ERP Oficina Inteligente (`wfOrdemDeServico.aspx`):
- **Código:** 1856 | **Empresa:** ReiDoModulo | **Cliente:** LUTUM MOTORS | **Veículo:** FUSCA NOVO
- **Início:** 29/08/2026 11:48 sáb | **Fim:** 30/09/2026 13:17 qua
- **Alerta no topo:** `O.S. fechada e bloqueada, clique em Mais Opções... para desbloquear`
- **Total da OS:** R$ 4.000,00
- **Pago:** R$ 4.000,00 (1 parcela via PIX em 30/09/2026)
- **Restante:** R$ 0,00
- **Lançamento enviado ao Financeiro?** Não

### Cadeia de Causa Raiz Investigada no Código Real:

1. **Defeito 1 — Abas AJAX não ativadas no Playwright (`os_deep_inspector.ts`):**
   - Na função `extrairDetalheDaPagina(detailPage)` (linhas 167-360), o script lia o DOM imediatamente após o `load` inicial da página, onde apenas a primeira aba ("Produtos e Serviços") estava renderizada.
   - O ERP Oficina Inteligente utiliza `AjaxControlToolkit.TabContainer` do ASP.NET WebForms. As demais 8 abas (**Buscar Produtos e Serviços**, **Pagamentos**, **Documentos**, **Notas**, **Agendamento(s)**, **Check-List**, **Garantia(s)**, **Histórico**) demandam clique ativo na aba ou carregamento sob demanda para que suas grids e campos ocultos existam no DOM.
   - Sem o clique na aba de Pagamentos, `pagamentos` retornou `[]`, `valor_pago` retornou `0`, e `valor_restante` caiu para `total_os` (R$ 4.000,00). As demais abas também sofriam de sub-extração ou dados incompletos.

2. **Defeito 2 — Falta de Extração de Status de Bloqueio/Encerramento e `data_fim` (`os_deep_inspector.ts`):**
   - `extrairDetalheDaPagina` não inspecionava o banner textual `"O.S. fechada e bloqueada"`, nem lia os campos de encerramento (`#ctl00_cph_txtDataFim`, `#ctl00_cph_txtHoraFim`, ou o regex de cabeçalho `Fim\s+(\d{2}/\d{2}/\d{4})`), nem capturava o status cadastral da OS (`#ctl00_cph_ddlStatus`).
   - O objeto retornado por `extrairDetalheDaPagina` sequer possuía a propriedade `status_grid`, de modo que `detalhe.status_grid` sempre chegava como `undefined`.

3. **Defeito 3 — Loop Catastrófico de Reabertura Nominal (`deep-crawler.ts` linhas 230-246):**
   - Quando a OS sumiu da grade de OSs em aberto (porque foi faturada/fechada em 30/09), `salvarLoteOSs` a colocou corretamente em `TRANSICAO_PENDENTE` com `origem_transicao = 'AUSENTE_GRADE_PAGINADA'`.
   - Em seguida, o crawler executou a checagem nominal individual: `detalhe = await extrairDetalhe(page, p.os_id, BASE)`.
   - Como `detalhe.status_grid` veio `undefined` e `detalhe.data_fim` veio nulo, `isFechada` avaliou para `false`.
   - E como `detalhe.extracao_completa` veio hardcoded como `true`, o código caiu no `else if (detalhe.extracao_completa)`:
     ```typescript
     formalizarTransicaoNominalOS(db, p.os_id, slug, 'ABERTA', 'VALIDACAO_NOMINAL_ABERTA', detalhe);
     ```
   - Isso forçou a OS de volta para `is_aberta = 1`, `estado_operacional = 'ABERTA'`, com `valor_pago = 0` e `valor_restante = 4000`, perpetuando a OS fechada e paga como se fosse um veículo aberto e inadimplente no pátio.

---

## 2. Solução Proposta: Mapeamento Total 360° (9 Abas + Cabeçalho)

Conforme instrução direta do usuário, a solução não apenas corrigirá os pagamentos, mas executará a varredura completa de todas as 9 abas de todas as ordens de serviço:

### 2.1 Varredura Sequencial e Robusta das 9 Abas no Playwright:
Ao abrir o popup `wfOrdemDeServico.aspx`, o Playwright navegará pelas abas garantindo o disparo dos eventos AJAX do ASP.NET WebForms e renderização das tabelas:
1. **Produtos e Serviços:** Itens da OS (`ucOrdemDeServicoItem_grd`), código, referência, descrição, quantidade, valor unitário, valor total, executor/mecânico, totalizador geral, desconto, total produtos, total serviços.
2. **Buscar Produtos e Serviços:** Mapeamento de catálogo vinculado/itens em consulta na ordem.
3. **Pagamentos:** Vencimentos e parcelas (`ucOrdemDeServicoPagamento_grd`): parcela, vencimento, forma (PIX, cartão, boleto, dinheiro), valor, nº operação, nº cheque, enviado ao financeiro (Sim/Não), valor total pago (`txtTotalValor`), valor restante (`txtRestante`).
4. **Documentos:** Grid de anexos (`ucOrdemDeServicoDocumento_grd`): origem, data, descrição, opções de download.
5. **Notas:** Grid fiscal (`ucOrdemDeServicoFiscal_grd`): número da nota, chave, data de emissão, status fiscal e valores.
6. **Agendamento(s):** Agendamentos operacionais (`ucPlacaDoVeiculoAgenda_grd`) e alertas de manutenção preventiva (`ucPlacaDoVeiculoAlerta_grd`).
7. **Check-List:** Vistorias vinculadas (`ucOrdemDeServicoCheckList_grdCheckList`): código, data, tipo (entrada/saída/mecânico), responsável, status, hodômetro, progresso e término.
8. **Garantia(s):** Processos de garantia (`ucOrdemDeServicoOperacaoEstoque_grdOperacaoEstoque`): operação, hodômetro, entrada estoque e peças.
9. **Histórico:** Auditoria do sistema (`tab_tapHistorico`): criado em, criado por, atualizado em, atualizado por.

### 2.2 Extração Factual do Cabeçalho e Trava de Bloqueio:
- Captura de `is_bloqueada_fechada` via detecção textual `"O.S. fechada e bloqueada"`.
- Captura de `data_inicio` e `data_fim` precisas (do DOM e do cabeçalho).
- Captura do status da OS (`status_grid` / `status_os`).
- Se `is_bloqueada_fechada === true` ou `data_fim` preenchida ou `valor_restante === 0` com `valor_pago >= total_os`, a OS é categorizada sem ambiguidade como `ENCERRADA` (`is_aberta = 0`).

### 2.3 Correção do Motor de Transição Nominal (`deep-crawler.ts`):
- Se a checagem nominal comprova que a OS está bloqueada, finalizada, faturada ou com saldo zero e data fim: formalizar como `ENCERRADA` (`VALIDACAO_NOMINAL_FECHADA`).
- Eliminar a reabertura cega baseada em `extracao_completa`: só marcar `ABERTA` se o status nominal for explicitamente "ABERTO" e a OS não estiver bloqueada/fechada.

### 2.4 Reconciliação do Banco Operacional SQLite (`hydra_ops.db`):
- Atualizar OS #1856 (Fusca Novo - Rei do Módulo) para `is_aberta = 0`, `estado_operacional = 'ENCERRADA'`, `total_os = 4000`, `valor_pago = 4000`, `valor_restante = 0`, `data_fim = '30/09/2026 13:17'`.
- Auditar e reconciliar outras eventuais OSs com divergência similar na rede.

---

## 3. Contratos de Dados (Modelo 360°)

```typescript
export interface DocumentoAbertoCompleto {
  id: string;
  tipo: 'OS' | 'OR';
  empresa: string;
  data_inicio: string;
  data_fim: string | null;
  veiculo: string;
  placa: string;
  cliente_nome: string;
  cliente_cpf?: string;
  cliente_telefone?: string;
  cliente_telefone_sms?: string;
  responsavel: string;
  status_grid: string;
  is_aberta: number;
  is_bloqueada_fechada: boolean;
  dias_no_patio: number;
  total_os: number;
  valor_pago: number;
  valor_restante: number;

  // 1. Aba Produtos e Serviços
  itens: ItemOS[];
  desconto_pct?: string;
  total_produtos_pct?: string;
  total_servicos_pct?: string;

  // 2. Aba Buscar Produtos e Serviços
  busca_itens_disponiveis?: any[];

  // 3. Aba Pagamentos
  pagamentos: PagamentoOS[];

  // 4. Aba Documentos
  documentos_anexos: AnexoOS[];

  // 5. Aba Notas
  notas_fiscais: string[];

  // 6. Aba Agendamento(s)
  agendamentos: AgendamentoOS[];
  alertas_preventiva: AlertaPreventivaOS[];

  // 7. Aba Check-List
  checklists: CheckListOS[];

  // 8. Aba Garantia(s)
  garantias: GarantiaOS[];

  // 9. Aba Histórico
  historico_criado_em?: string;
  historico_criado_por?: string;
  historico_atualizado_em?: string;
  historico_atualizado_por?: string;

  extracao_completa: boolean;
  erro?: string;
}
```

---

## 4. Riscos e Mitigações

- **Risco:** O ciclo de clique em todas as 9 abas tornar a extração mais demorada.
- **Mitigação:** 
  1. No crawler principal do pátio diário, a leitura em lote continua aproveitando a grade paginada rápida.
  2. A extração 360° com as 9 abas é executada:
     - Durante a inspeção profunda de OSs que precisam de detalhe;
     - Na validação nominal de transição de OSs ausentes da grade;
     - Sob demanda via ferramentas MCP / Consultas pontuais.
  3. Transição de abas otimizada com detecção de visibilidade e timeout defensivo de 400ms por aba.
