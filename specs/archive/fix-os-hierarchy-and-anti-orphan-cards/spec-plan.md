# Plano de Implementação: Hierarquia Visual Hermes 2.0 & Blindagem Anti-Orphan Card

## Tarefas de Implementação

### 1. Guardrails Visuais e Sanitização em `format_utils.ts`
- [x] [FORMAT] Atualizar `reformatPipedLinesToHermesCards` para gerar o padrão em árvore com joelho (`*OS...*` + `  └ Status:` + `  └ Financeiro:` + `  └ Operação:`) e linha em branco entre cada OS.
- [x] [FORMAT] Adicionar regra em `sanitizeWhatsAppMarkdown` que remove blockquotes residuais de títulos de OS (`> *OS...*` -> `*OS...*` e `> OS...` -> `*OS...*`).
- [x] [FORMAT] Converter automaticamente blocos de OS com marcadores legados (`- Status:`, `- Cliente:`, `- Valor:`) em joelho (`  └ Status:`, etc.).
- [x] [FORMAT] Blindar `splitIntoWhatsAppBlocks` com regra Anti-Orphan Card: uma ordem de serviço completa (cabeçalho + joelhos) é tratada como bloco atômico e nunca tem seu cabeçalho separado de seus atributos.

### 2. Reconhecimento de Árvore no Compositor Semântico (`balloon_composer.ts`)
- [x] [BALLOONS] Atualizar `splitIntoAtomicItems` para reconhecer `└` como indicador de linhas filhas de card atômico (`hasFieldBullets`).
- [x] [BALLOONS] Garantir que nenhum card com joelho seja quebrado internamente ao ser empacotado nos balões semânticos.

### 3. Preservação de Balões do Dispatcher em `webhook-listener.js`
- [x] [WEBHOOK] Ajustar `runDispatcherAsync` para verificar se `parsed.messages` já é um array de balões válidos e despachá-lo diretamente, evitando re-agrupamento e re-fatiamento destrutivo.

### 4. Diretrizes Operacionais e Foco de Pátio
- [x] [PROMPT] Reforçar em `HERMES_DIRECTIVES`, `agent_dispatcher.ts` e `system_prompt.md` que consultas de pátio/OSs de loja listam com cards individuais estritamente as ordens ativas (`is_aberta = 1`), resumindo ordens finalizadas/faturadas em números agregados.

### 5. Compilação, Testes e Validação na VPS
- [x] [BUILD] Recompilar `format_utils.js` e `balloon_composer.js` via `esbuild`.
- [x] [TESTS] Adicionar testes unitários em `test_query_routing_and_formatting.ts` cobrindo:
  - Conversão do payload legado de 12:13 (`> OS #468` com `- Status: Finalizada`) para o formato em árvore com joelho `  └ `.
  - Validação de que nenhum balão encerra com título de OS desacompanhado de seus dados (Zero Orphan Titles).
  - Verificação de espaçamento duplo entre OSs.
- [x] [DEPLOY] Sincronizar arquivos para `/home/operacional/hydra-deploy/current/` e `/opt/bots/`.
- [x] [PM2] Reiniciar `hydra-bot` e auditar logs de inicialização.

---

## Critérios de Aceite
1. **Zero Títulos de OS com `>` ou Bullets:** Todo card de OS deve ser `*OS #XXXX — MODELO (PLACA)*` em negrito isolado.
2. **100% Subitens em Joelho:** Todo atributo da OS deve ser precedido de `  └ ` com 2 espaços de recuo.
3. **Respiro Visual:** Toda OS separada da seguinte por linha em branco (`\n\n`).
4. **Zero Títulos Órfãos:** Nenhum balão de WhatsApp pode encerrar com cabeçalho de OS deixando seus atributos para o balão seguinte.
5. **Suíte 100% Green:** Todos os testes passando sem quebras.
