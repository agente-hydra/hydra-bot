# Plano de Execução: Expurgo de Botões Interativos e Restauração da Formatação Executiva Hermes

**Spec ID:** `revert-buttons-restore-hermes-format`  
**Data:** 09/10/2026  
**Status:** Concluído (Deploy em Produção Validado)  

---

## Checklist de Execução

### Fase 1: Expurgo de Botões e Listas Interativas
- [x] [DISPATCHER] Remover a propriedade `interactiveList` da interface `DispatcherOutput` em `src/hydra-sync/agent_dispatcher.ts`.
- [x] [DISPATCHER] Remover a montagem de `composeOSInteractiveListPayload` e o bloco de detecção de botões interativos nas linhas finais de `dispatchMessage`.
- [x] [WEBHOOK] Remover a chamada `sendWhatsAppList` e o envio de listas do `webhook-listener.js`.
- [x] [CONTRACT] Limpar referências de payload de lista em `src/hydra-sync/types/evo_interactive_contract.ts`.

### Fase 2: Restauração da Listagem de OSs por Loja
- [x] [ROUTING] Garantir que queries plurais como `"OSs do jabaquara"`, `"ordens de jabaquara"`, `"carros no pátio de jabaquara"` sejam categorizadas como consulta de ordens de serviço da unidade.
- [x] [FORMATTING] Implementar formatação hierárquica em árvore usando o joelho `  └ ` para cada OS, com título em negrito no topo e espaçamento de parágrafos entre ordens (zero dados aglomerados ou estilo tabela).
- [x] [GUARD] Blindar o dispatcher para nunca tentar resolver "OSs" como o modelo de veículo Crossfox.

### Fase 3: Restauração do Card Hermes 360 Completo para Veículos e OSs
- [x] [COMPOSER] Restaurar `composeFullOS360Card` como a composição oficial quando um veículo ou OS individual for solicitado.
- [x] [COMPOSER] Eliminar definitivamente qualquer texto de URA ("MÓDULOS DISPONÍVEIS", "Selecione uma opção no menu ou digite: SERVICOS...").
- [x] [BLOCKS] Garantir que o particionamento em 4 balões (`---BLOCK---`) seja entregue sem truncamento pelo `splitIntoWhatsAppBlocks`.

### Fase 4: Testes Locais e Validação
- [x] [TEST] Atualizar e executar a suíte de testes em `src/hydra-sync/tests/test_query_routing_and_formatting.ts` (26/26 testes aprovados).
- [x] [BUILD] Executar `npx tsx` e verificar que não há erros de compilação ou execução.
- [x] [DEPLOY] Sincronizar arquivos para a VPS (`operacional@100.126.50.101`).
- [x] [RESTART] Reiniciar `hydra-bot` no PM2 da VPS e testar na prática a query `"OSs do jabaquara"`.

---

## Hard Stop (SDD Apply Finalizado)
Todas as etapas de implementação e validação na VPS foram concluídas com sucesso. O agente para agora e aguarda o comando do usuário `/sdd-archive` para consolidação de memória, graphify e git commit.
