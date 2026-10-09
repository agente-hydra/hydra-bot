# Design de Arquitetura — Extração do Excel de Contas a Pagar, Retenção e Vetorização MCP (hydra-contas-pagar-excel-retention-vector)

**Spec ID:** `hydra-contas-pagar-excel-retention-vector`  
**Data:** 09/10/2026  
**Status:** Design  

---

## 1. Fluxo de Dados e Ciclo de Vida

```
[wfContaBuscaPagar.aspx]
       │
       ├─► 1. Busca preenchida (Data Pagamento, Todas Empresas, Ontem/Fim de Semana)
       │
       ├─► 2. Formato PDF (#ctl00_cph_rblFormato_0) ──► Imprimir ──► Salva PDF (WhatsApp)
       │
       └─► 3. Formato Excel (#ctl00_cph_rblFormato_1) ──► Imprimir ──► Salva Excel na VPS
                                                                          │
       ┌──────────────────────────────────────────────────────────────────┘
       ▼
[Parser Estruturado SheetJS]
       │
       ├─► Ingestão Relacional (SQLite: contas_pagar_lancamentos)
       │
       └─► Vetorização Semântica (Embedder: vec_contas_pagar)
               │
               ▼
       [MCP Tool: consultar_despesas_pagas / buscar_pagamento_fornecedor]
               ▲
               │ (Perguntas da IA via chat/WhatsApp)
       
═════════════════════════════════════════════════════════════════════════════
[Rotina Diária de Retenção: contas_pagar_retention.ts]
       │
       ▼
   Verifica arquivos `Contas a Pagar - *.xls*` na pasta /crawls/
   Se mtime > 48 horas (2 dias) ──► Exclui com segurança do disco
   (Dados continuam preservados para sempre no banco SQLite e nos vetores!)
```

---

## 2. Contratos e Interfaces TypeScript (Sem `any`)

### 2.1 Modelo de Dados do Lançamento de Contas a Pagar

```typescript
export interface LancamentoContaPagar {
  id: string; // "loja_slug:codigo:parcela"
  lojaSlug: string;
  lojaOriginal: string;
  codigo: number;
  parcela: string;
  fornecedor: string;
  descricao: string;
  tipo: string;
  dataVencimento: string; // YYYY-MM-DD
  dataPrevisao: string;   // YYYY-MM-DD
  valorAPagar: number;
  status: string;
  dataPagamento: string;  // YYYY-MM-DD
  valorPago: number;
  dataExtracao: string;   // ISO 8601
  textoSemantico?: string;
}

export interface ExtracaoDuplaResult {
  pdfPath: string;
  pdfBytes: number;
  excelPath: string;
  excelBytes: number;
  totalLancamentos: number;
  valorTotalPago: number;
  duracaoMs: number;
}
```

### 2.2 Schema SQL Relacional & Vetorial (SQLite WAL)

```sql
-- Tabela Relacional Estruturada
CREATE TABLE IF NOT EXISTS contas_pagar_lancamentos (
    id TEXT PRIMARY KEY,
    loja_slug TEXT NOT NULL,
    loja_original TEXT NOT NULL,
    codigo INTEGER NOT NULL,
    parcela TEXT NOT NULL,
    fornecedor TEXT NOT NULL,
    descricao TEXT NOT NULL,
    tipo TEXT NOT NULL,
    data_vencimento TEXT NOT NULL,
    data_previsao TEXT,
    valor_a_pagar REAL NOT NULL,
    status TEXT NOT NULL,
    data_pagamento TEXT NOT NULL,
    valor_pago REAL NOT NULL,
    data_extracao TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_cp_data_pgto ON contas_pagar_lancamentos(data_pagamento);
CREATE INDEX IF NOT EXISTS idx_cp_loja ON contas_pagar_lancamentos(loja_slug);
CREATE INDEX IF NOT EXISTS idx_cp_fornecedor ON contas_pagar_lancamentos(fornecedor);

-- Tabela Vetorial (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_contas_pagar USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[768]
);
```

### 2.3 Política de Retenção de Arquivos (TTL $\ge$ 2 Dias)

```typescript
export interface RetentionPolicyOptions {
  caminhoDiretorio: string;
  padraoNome: RegExp;
  minHorasRetencao: number; // Padrão: 48 (2 dias completos)
  dryRun?: boolean;
}

export interface RetentionPruneResult {
  arquivosExaminados: number;
  arquivosExcluidos: string[];
  arquivosMantidos: string[];
  espacoLiberadoBytes: number;
}
```

---

## 3. Estratégia de Vetorização e Enriquecimento Semântico

Cada linha do Excel é convertida em um documento semântico estruturado para o embedding:

```typescript
export function gerarTextoSemanticoConta(conta: LancamentoContaPagar): string {
  const dataFormatada = conta.dataPagamento.split('-').reverse().join('/');
  return [
    `Pagamento efetuado na loja ${conta.lojaOriginal} (${conta.lojaSlug}).`,
    `Valor pago: R$ ${conta.valorPago.toFixed(2)} (Valor original: R$ ${conta.valorAPagar.toFixed(2)}).`,
    `Favorecido/Fornecedor: ${conta.fornecedor}.`,
    `Histórico: ${conta.descricao}.`,
    `Data do pagamento: ${dataFormatada}. Parcela: ${conta.parcela}. Código ERP: ${conta.codigo}. Tipo: ${conta.tipo}.`
  ].join(' ');
}
```

Esse formato permite à IA responder a perguntas de alta granularidade:
- *"Qual foi o gasto com seguro de incêndio em Mauá e Rudge?"*
- *"Houve pagamento para DHJV referente a óleo ontem?"*
- *"Quais foram os 3 maiores pagamentos de peças e serviços de terceiros realizados na sexta-feira?"*

---

## 4. MCP Tools Prontas para a IA

Ferramenta MCP a ser registrada no servidor de ferramentas da IA:
- `mcp_consultar_contas_pagas`:
  - Argumentos: `data_inicio`, `data_fim`, `loja`, `fornecedor`, `termo_busca`
  - Retorno: Resumo somado, total pago e lista detalhada com fornecedor, descrição, valor e loja.
