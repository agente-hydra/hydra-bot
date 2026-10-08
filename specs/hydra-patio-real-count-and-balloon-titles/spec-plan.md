# Plano de Implementação: Pátio Físico Operacional Real & Divisão Inteligente de Balões por Título

**Spec ID:** `hydra-patio-real-count-and-balloon-titles`  
**Status:** PLANO / EM REVISÃO (SDD Hard Stop)  

---

## Tasks Atômicas de Implementação

### Fase 1: Camada de Dados e Consultas Operacionais (Pátio Real)
- [x] **[DB] Refatorar Consulta de Pátio em `getPatioOverview`**
  - Arquivo: `src/hydra-sync/db_repository.ts`
  - Implementar filtro discriminando status ativos de oficina (`VEICULO EM EXECUÇÃO`, `EM DIAGNOSTICO`, `EM TESTE`, `AGUARDANDO PEÇA`, `SERVIÇO TERCEIRIZADO`, `NA FILA PARA EXECUÇÃO`, etc.) e desconsiderando `AGUARDANDO RETIRADA` com saldo zerado e data superior a 5 dias.
  - Retornar campos: `veiculos_patio_fisico`, `pendencias_baixa_erp`, `total_abertas`, `total_valor`, `total_restante`.

- [x] **[DB] Atualizar `getStoreDrilldown` e `getOpenOSCounts`**
  - Arquivo: `src/hydra-sync/db_repository.ts`
  - Garantir consistência da contagem de pátio individual de cada unidade com a mesma regra anti-fantasma.

- [x] **[MCP] Atualizar Ferramentas MCP em `mcp_server.ts`**
  - Arquivo: `src/hydra-sync/mcp_server.ts`
  - Atualizar schema e retorno de `get_patio_overview` e `get_store_drilldown` com a descrição clara das métricas.

---

### Fase 2: Formatação e Divisão de Balões por Título (Title-Aware WhatsApp Splitting)
- [x] **[FORMATTER] Implementar `isSectionHeader` em `format_utils.ts`**
  - Arquivo: `src/hydra-sync/format_utils.ts`
  - Criar detector determinístico para linhas de cabeçalho (`> Título`, `> *Título*`, `> 1. Título`, `*1. Título*`).

- [x] **[FORMATTER] Aprimorar `splitIntoWhatsAppBlocks` com Consciência de Títulos**
  - Arquivo: `src/hydra-sync/format_utils.ts`
  - Implementar regra Anti-Orphan-Title (um título nunca pode ser o último parágrafo de um balão).
  - Implementar regra de Quebra Natural por Seção Temática quando um novo título principal for iniciado e o balão anterior tiver tamanho substantivo (>= 300 caracteres).

---

### Fase 3: Prompts e Diretrizes Conversacionais
- [x] **[PROMPT] Calibrar Diretrizes no `system_prompt.md` e `agent_dispatcher.ts`**
  - Arquivos: `src/hydra-sync/system_prompt.md` e `src/hydra-sync/agent_dispatcher.ts`
  - Reforçar que veículos em pátio referem-se à ocupação física ativa nas oficinas (~3 a 6 por loja, total ~35 a 40 na rede).
  - Incluir recomendação para emissão de `---BLOCK---` entre grandes seções de diagnósticos analíticos múltiplos.

---

### Fase 4: Validação, Testes e Build Gate
- [x] **[TESTS] Criar Teste de Quebra de Balões (`test_balloon_title_splitter.ts`)**
  - Validar o caso real trazido pelo usuário (Diagnóstico com seções 1, 2 e 3 dividindo nos títulos sem deixar cabeçalhos órfãos).
- [x] **[TESTS] Criar Teste de Pátio Real (`test_real_patio_overview.ts`)**
  - Validar contra o banco SQLite que Santo André acusa 1 veículo (e não 23), e que o total da rede fica na faixa de 35 a 40.
- [x] **[GATE] Build Gate TypeScript**
  - Executar `npm run typecheck:hydra` para garantir zero erros de tipagem.
