# Proposta Técnica — Extração do Excel de Contas a Pagar, Política de Retenção e Vetorização MCP (hydra-contas-pagar-excel-retention-vector)

**Spec ID:** `hydra-contas-pagar-excel-retention-vector`  
**Data:** 09/10/2026  
**Status:** Proposta (Aguardando Aprovação)  
**Ambiente:** 100% VPS Linux (`operacional@100.126.50.101`)  

---

## 1. Problema e Justificativa

Atualmente, o pipeline automatizado extrai o relatório oficial em PDF de Contas a Pagar (`Contas a Pagar - DD-MM-AAAA.pdf`) para envio no WhatsApp. No entanto, o formato PDF é estático e dificulta auditorias detalhadas, agregações financeiras e consultas analíticas inteligentes por IA.

O ERP Oficina Inteligente na mesma tela (`wfContaBuscaPagar.aspx`) disponibiliza a exportação nativa em formato Excel (`#ctl00_cph_rblFormato_1`), contendo 12 colunas granulares: Loja/Empresa, Código do Lançamento, Parcela, Favorecido/Fornecedor, Descrição/Histórico, Tipo, Datas e Valores pagos.

O usuário solicitou:
1. **Extrair também a planilha Excel** de Contas a Pagar durante o ciclo do crawler.
2. **Armazenar o Excel na VPS por pelo menos 2 dias** (política de retenção de 48h a 72h) com expurgo automático após o período para não sobrecarregar o disco.
3. **Persistir os dados estruturados e indexar em vetor (sqlite-vec / embeddings) para consumo futuro via MCP da IA**, viabilizando perguntas em linguagem natural como *"Quanto foi pago de aluguel ou seguros ontem?"* ou *"Liste pagamentos para Auto Elétrica"*.

---

## 2. Requisitos e Escopo da Solução

### 2.1 Extração Dupla (PDF + Excel)
- No momento da extração de Contas a Pagar no ERP:
  1. Primeiro passo: seleciona PDF (`#ctl00_cph_rblFormato_0`), clica em Imprimir e salva o PDF oficial.
  2. Segundo passo imediato: seleciona Excel (`#ctl00_cph_rblFormato_1`), clica em Imprimir e salva `Contas a Pagar - DD-MM-AAAA.xlsx` (ou `.xls`).
- Ambos os arquivos são gerados a partir da mesma consulta e filtros (mesmo snapshot exato).

### 2.2 Política de Retenção na VPS (TTL $\ge$ 2 dias)
- Diretório de retenção: `/home/operacional/hydra-data/crawls/` (e `/home/operacional/hydra-data/contas-pagar/`).
- Regra de expurgo:
  - Arquivos Excel brutos com `mtime` > 48 horas (2 dias completos) são elegíveis para deleção segura.
  - A rotina de limpeza (`pruneOldExcelFiles`) roda diariamente na VPS e remove apenas arquivos `Contas a Pagar - *.xls*` mais antigos que 2 dias.
  - O PDF diário pode manter retenção mais longa ou seguir política similar.

### 2.3 Ingestão Estruturada (SQLite) e Vetorização Semântica (MCP Readiness)
- Antes do expurgo do Excel, um parser lê as linhas do arquivo e realiza upsert na tabela relacional do SQLite:
  `contas_pagar_lancamentos` (Chave única: `loja_slug + codigo_lancamento + parcela`).
- Gera documentos semânticos para cada lançamento:
  `"Pagamento [Loja: MPrudge] R$ 1.501,17 para ALLIANZ SEGUROS S/A - REF. SEGURO INCENDIO CAP em 08/10/2026"`
- Grava os vetores em `vec_contas_pagar` via `embeddings.ts` (já existente no ecossistema Hydra).
- Prepara a interface de consulta MCP para que agentes e usuários possam consultar despesas e fornecedores via chat com precisão cirúrgica.

---

## 3. Evidências do DOM e Layout do Excel Real

Comprovado por inspeção direta na VPS:
- **Elemento Seletor de Formato:** `<input id="ctl00_cph_rblFormato_1" type="radio" value="2">` (Excel)
- **Arquivo Retornado pelo ERP:** `BuscaContasAPagar.xls` (12.288 bytes)
- **Cabeçalho Real das Colunas (Linha 4):**
  1. `Emp`: Sigla da Loja (`ReiDoOleoMaua`, `MPrudge`, `MPSantoAndre`, `ReiDoModulo`, `MPdompedro1`...)
  2. `Código`: Identificador numérico do lançamento no ERP (ex: `21310`)
  3. `Parc`: Número da parcela (ex: `1/1`, `1/2`)
  4. `Cliente/Fornecedor`: Razão social ou nome do favorecido (ex: `ALLIANZ SEGUROS S/A`)
  5. `Descrição`: Histórico completo do lançamento (ex: `REF. SEGURO INCENDIO MAUA...`)
  6. `Tipo`: Tipo contábil (ex: `LCTO`)
  7. `Dt. Vecto`: Data de vencimento (serial Excel ou string)
  8. `Dt. Previsão`: Data de previsão
  9. `Vl. a Pagar`: Valor original a pagar
  10. `Status`: Situação do lançamento (`PAG` = Pago)
  11. `Dt. Pgto`: Data efetiva de pagamento
  12. `Vl. Pago`: Valor efetivamente pago

---

## 4. Matriz de Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **Formato `.xls` legado (BIFF8)** | Incompatibilidade com parsers que esperam `.xlsx` | Utilizar a biblioteca `xlsx` (`SheetJS`), já instalada na VPS, que lê perfeitamente tanto `.xls` legado quanto `.xlsx`. |
| **Exclusão prematura de arquivos** | Perda de planilhas ainda úteis | Trava estrita de tempo: `idadeArquivoMs >= 2 * 24 * 60 * 60 * 1000` (48h completas). Arquivos com menos de 2 dias nunca são deletados. |
| **Duplicação de lançamentos na vetorização** | Poluição da base vetorial | Chave primária canônica `loja_slug:codigo:parcela` com cláusula `ON CONFLICT DO UPDATE`. |
