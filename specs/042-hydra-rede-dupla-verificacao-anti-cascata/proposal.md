# Proposta de Mudança — Spec 042: Hydra Rede Dupla Verificação Anti-Cascata e Blindagem S3

## 1. Problema e Diagnóstico Cirúrgico
O extrator do portal Meu Rede (`projects/hydra-rede/src/scraper.js`) apresentou ocorrências de falhas em cascata, troca/duplicação entre lojas (`LOJA X LOJA`), divergência de valores (`BRUTO X REDE` / `LÍQUIDO X REDE`) e consolidação incompleta com ausência de lojas (`Faltou JB + DP`).

A perícia técnica detalhada no relatório Argon identificou **4 causas-raiz exatas** no código atual:
1. **Fallback Cego e Condição Permissiva na Fila S3 (`exportarExcel`)**:
   - No loop de polling de `downloads/queue`, a checagem `(!x.pvCode || String(x.pvCode) === String(loja.ec))` aceita itens sem `pvCode` gerados por lojas anteriores.
   - O fallback imediato `storeItem` procura qualquer item `DONE` da loja sem verificar `!existingIds.has(x.id)`, baixando arquivos defasados/antigos no primeiro ciclo de 2s enquanto o novo relatório ainda está `PROCESSING`.
2. **Perda Silenciosa de `existingIds` na Reciclagem de Aba**:
   - Cada loja abre uma nova página com `context.newPage()`. Ao consultar `downloads/queue` antes do clique com `try { ... } catch (_) {}`, se o token expirar ou a requisição falhar, `existingIds` torna-se `Set(0)`, cegando a verificação de novidade.
3. **Ausência de Captura dos Totais Oficiais na Tela de Vendas**:
   - O scraper não lê os totalizadores que o próprio portal exibe na tela e na API interna (Valor Bruto, Valor Líquido e Quantidade de Transações) para conferir com o Excel baixado.
4. **Consolidação Sem Bloqueio em Falhas**:
   - Em caso de falha em qualquer loja (como Jorge Beretta `JB` ou Dom Pedro `DP`), o bloco `else` insere `dados: []` com valores zerados e consolida a planilha `Juros Rede - DD-MM-AAAA.xlsx` incompleta, sem barrar o ciclo.

---

## 2. Refinamentos Arquiteturais Críticos

1. **Invalidação do Checkpoint no Gate 2 (Anti-Trava de Resume)**:
   - Se uma loja passar individualmente no Gate 1 (marcada como `SUCCESS` no state), mas for reprovada no Gatekeeper Global (Gate 2) por colisão `LOJA X LOJA` (hash clonado ou transações repetidas), ela **não pode** permanecer como `SUCCESS` no `state_<dateTag>.json`.
   - Antes do `throw new Error(...)` no Gate 2, o sistema invoca `recordStoreFailure(state, ecReprovado, 'Reprovado na Dupla Verificação Global')` para todos os ECs reprovados, garantindo que execuções subsequentes não pulem essas lojas.

2. **Aplicação Unificada no Loop Principal e na Segunda Passada de Contingência**:
   - O pipeline blindado (`navegarECapturarResumoRede` + `exportarExcelBlindado` + `validarLojaContraRede` + descarte de arquivo corrompido) deve rodar de forma idêntica tanto no loop principal (`for (const loja of pendingStores)`) quanto no loop de recuperação (`for (const loja of stillPending)`).
   - Preservação de retrocompatibilidade: exportação dos métodos legados como aliases no `module.exports` (`navegarRelatorioVendas` e `exportarExcel`).

3. **Alinhamento Temporal: Resumo da Rede vs. Filtro do `processarRelatorioRede`**:
   - O portal da Rede pode abrir por padrão com range mais amplo (ex: últimos 7 dias ou mês atual) caso não haja aplicação de filtro no DOM, enquanto `processarRelatorioRede` filtra estritamente por `targetDatesInfo`.
   - Para blindar a comparação sem falsos-positivos:
     - `excel_processor.js` passa a computar e retornar nos `stats` tanto `totalBruto` e `totalLiquido` (filtrados para a data-alvo) quanto `totalBrutoArquivoCompleto` e `totalLiquidoArquivoCompleto`.
     - `validarLojaContraRede` valida a paridade contra a métrica correspondente (se a tela estiver filtrada no dia, compara contra o filtrado; se a tela refletir o total do lote exportado, compara contra o total do arquivo).

---

## 3. Critérios de Aceite
- [ ] `exportarExcelBlindado` elimina sequestro de arquivos S3 e validação cega.
- [ ] `navegarECapturarResumoRede` extrai com resiliência os valores oficiais via API e DOM da Rede.
- [ ] `validarLojaContraRede` e `executarDuplaVerificacaoGlobal` bloqueiam 100% dos 5 cenários reais de falha.
- [ ] Reprovações no Gate 2 invalidam os ECs afetados no `state_manager` com `recordStoreFailure`.
- [ ] O fluxo de Contingência utiliza 100% da esteira blindada.
- [ ] Bateria de testes unitários (`node tests/test_dupla_verificacao.js --unit`) aprova com sucesso.
- [ ] Sincronização e validação completa no ambiente de produção VPS (`operacional@100.126.50.101`).
