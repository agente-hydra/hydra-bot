# Plano de Implementação — OS Interativa Evolution API (hydra-evo-interactive-os)

**ID da Spec:** `hydra-evo-interactive-os`  
**Data:** 08/10/2026  
**Status:** CONCLUÍDO COM SUCESSO (100% PASS NO BUILD GATE E TESTES)  

---

## Critérios Obrigatórios de Aceite

- [x] **[API_VERIFY]** Confirmar payload real suportado pela versão da Evolution API (`v2.3.7` validada com sucesso em `evo.tork.services`: exige `number`, `title`, `description`, `buttonText`, `footerText`, `sections` com `rows` contendo `title`, `description`, `rowId`).
- [x] **[TEST_SEND_LIST]** Criar teste do envio de `sendList` (mockando fetch e validando body JSON e headers).
- [x] **[FIXTURE_WEBHOOK]** Criar fixture realista do webhook de clique em `rowId` (`body.data.message.listResponseMessage.singleSelectReply.selectedRowId`).
- [x] **[TEST_FALLBACK_TEXT]** Testar fallback por texto normalizado (`SERVICOS 18503`, `PECAS`, `PAGAMENTOS`, `DOCUMENTOS`, `HISTORICO`).
- [x] **[TEST_HYBRID_FREE_TEXT]** Testar comportamento híbrido: envio de mensagem livre durante navegação ativa de OS (ex: "o que foi conversado?", "faturamento de Mauá") não causa erro de menu e é respondido com inteligência contextual mantendo ou transitando o turno livremente.
- [x] **[TEST_EMPTY_DATA]** Testar OS sem cliente, telefone, documentos ou pagamentos (garantir que não ocorra crash nem texto vazio).
- [x] **[TEST_PAYMENT_METRICS]** Testar regra contábil de saldo pago (`Pago = soma das parcelas efetivamente recebidas/liquidadas`, saldo parcial, saldo zerado/quitado e saldo 100% devedor).
- [x] **[TEST_WHITELIST]** Testar bloqueio incondicional de instâncias não autorizadas (rejeitar instâncias de gerentes).
- [x] **[ZERO_PLACEHOLDERS]** Garantir que nenhuma mensagem contenha placeholders como `(Preencher Executor...)` ou códigos de catálogo irrelevantes.
- [x] **[ZERO_EMPTY_SECTIONS]** Garantir que nenhuma seção seja enviada vazia ou truncada.
- [x] **[ZERO_EMOJIS]** Garantir formatação executiva, limpa e sóbria sem nenhum emoji.
- [x] **[BUILD_AND_TEST]** Executar build gate (`npx tsc --noEmit`) e suíte de testes unitários garantindo 100% PASS antes de concluir.

---

## Fase 1: Tipos e Contratos da Evolution API
- [x] **[TYPES]** Criar `src/hydra-sync/types/evo_interactive_contract.ts`:
  - `EvoListRow`, `EvoListSection`, `EvoListPayload`.
  - `AllowedOSModule = 'servicos' | 'pecas' | 'pagamentos' | 'documentos' | 'historico'`.
  - Whitelist constante: `ALLOWED_OS_MODULES`.
- [x] **[DISPATCHER_TYPES]** Estender `DispatcherOutput` em `src/hydra-sync/agent_dispatcher.ts` com `interactiveList?: EvoListPayload`.

---

## Fase 2: Compositores Modulares de OS (Zero Emojis & Dados Reais)
- [x] **[COMPOSER_SUMMARY]** Implementar `composeExecutiveOSSummary(params: OS360CardParams): string` em `src/hydra-sync/os_situation_composer.ts`:
  - Resumo executivo sóbrio sem emojis.
  - Cálculo contábil de Total, Pago e Saldo Devedor.
  - Sumário de módulos com contagens reais.
  - Bloco de instrução com atalhos de texto normalizados.
- [x] **[COMPOSER_LIST]** Implementar `composeOSInteractiveListPayload(params: OS360CardParams, recipientPhone: string): EvoListPayload`:
  - Montar payload com `number`, `title`, `description`, `buttonText`, `footerText`, `sections`.
  - 5 rows com `rowId`: `os_{id}_servicos`, `os_{id}_pecas`, `os_{id}_pagamentos`, `os_{id}_documentos`, `os_{id}_historico`.
- [x] **[COMPOSER_MODULES]** Implementar as 5 funções atômicas de módulo:
  - `composeOSServicesCard`: Categorias mecânicas limpas sem emojis, com subtotais e sem placeholders do ERP.
  - `composeOSPartsCard`: Peças por sistema mecânico com valores e quantidades.
  - `composeOSPaymentsCard`: Parcelas discriminadas com status contábil (Recebido vs. A Vencer/Pendente), valor pago e saldo restante.
  - `composeOSDocumentsCard`: Documentos reais sem invenção (Inspeção de Entrada subordinada ao Checklist de Entrada, Checklist do Mecânico, NF real ou "Não informada", anexos arquivados).
  - `composeOSHistoryCard`: Auditoria do ERP (criador, data, editor, data, anotações de sistema) e tratativas do atendimento.

---

## Fase 3: Roteamento de Módulos e Normalização no Dispatcher
- [x] **[ROUTING_INTENT]** Criar função `parseOSModuleIntent(text: string, activeOsId?: string)` em `src/hydra-sync/agent_dispatcher.ts`:
  - Validação estrita de `rowId`: `/^os_(\d{1,8})_(servicos|pecas|pagamentos|documentos|historico)$/i`.
  - Normalizador de texto para comandos manuais e anáforas de OS.
- [x] **[ROUTING_DISPATCH]** Conectar no fluxo de resolução de OS:
  - Se consulta geral da OS: gerar `replyText = composeExecutiveOSSummary(...)` + `interactiveList = composeOSInteractiveListPayload(...)`.
  - Se consulta de módulo: gerar `replyText = composeOS{Modulo}Card(...)` + `interactiveList` para navegação contínua.
- [x] **[CLI_SERIALIZE]** Garantir que `agent_dispatcher_cli.ts` serialize `interactiveList` no JSON stdout.

---

## Fase 4: Ingress e Egress de Listas no `webhook-listener.js`
- [x] **[INGRESS]** Atualizar extração de mensagens recebidas no `webhook-listener.js`:
  - Extrair `selectedRowId` de `messageObj.listResponseMessage.singleSelectReply`.
  - Extrair botões interativos (`buttonsResponseMessage`, `templateButtonReplyMessage`, `interactiveResponseMessage`).
- [x] **[EGRESS]** Implementar função `sendWhatsAppList(phone, listPayload, maxRetries = 2)`:
  - Endpoint `POST ${EVOLUTION_URL}/message/sendList/${INSTANCE}`.
  - Trava de segurança: whitelist `ALLOWED_SENDER_INSTANCES = new Set(['hydra', 'atendimento'])`.
  - Validação de autorização no SQLite.
  - Logging estruturado em `whatsapp_delivery_logs`.
- [x] **[QUEUE_DELIVERY]** Integrar disparo de `interactiveList` no `processChatQueue` logo após o texto.

---

## Fase 5: Suíte de Testes Automatizados e Build Gate
- [x] **[UNIT_TESTS]** Criar `src/hydra-sync/tests/test_evo_interactive_os.ts`:
  - Teste 1: Validação de estrutura do payload `EvoListPayload` para a Evolution API v2.3.7.
  - Teste 2: Fixture de webhook com `listResponseMessage.singleSelectReply.selectedRowId`.
  - Teste 3: Normalização de comandos de texto de fallback com e sem acentos.
  - Teste 4: Regra de cálculo de pagamentos (soma das parcelas efetivamente recebidas).
  - Teste 5: OS com dados ausentes (sem cliente, telefone, documentos ou pagamentos).
  - Teste 6: Rejeição estrita de instâncias de gerentes no envio de listas.
  - Teste 7: Ausência total de emojis e placeholders no texto gerado.
- [x] **[BUILD_GATE]** Executar compilação TypeScript strict (`npx tsc --noEmit`).
- [x] **[TEST_RUN]** Executar `npx tsx src/hydra-sync/tests/test_evo_interactive_os.ts` com 100% PASS (89 testes aprovados, 0 falhas).
