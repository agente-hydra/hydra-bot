# Plano de Execução (Spec-Plan): Confirmação Privada de Reconexão, Watchdog SLA 5-Min Rei do Módulo e Triagem por LLM Local

**ID da Spec:** `052-reidomodulo-sla-triage-local-llm`  
**Data:** 29/10/2026  
**Status:** PLANO DE TAREFAS / AGUARDANDO APROVAÇÃO (`/vibe-apply 052-reidomodulo-sla-triage-local-llm`)  

---

## 1. Visão Geral das Tarefas

| Tarefa | Executor | Descrição | Arquivos Afetados | Gate de Validação |
|---|---|---|---|---|
| **Task 1** | `[LEAD]` | `[x] Completed` | Implementar notificação privada de reconexão ao gerente da loja | `whatsapp_notifier.js`, `watchdog_daemon.js`, `test_reconnect_system.js` | Teste unitário de reconexão com envio simulado para `phoneCanonical` |
| **Task 2** | `[LEAD]` | `[x] Completed` | Implementar Motor Heurístico / Regex Shield (Camada 1 de Triagem) | `src/sla_system/triage_regex_shield.js`, `test_triage_shield.js` | 100% de acurácia em bateria de testes com 20 mensagens reais (closings vs dúvidas) |
| **Task 3** | `[PARALLEL: local-slm]` | `[x] Completed` | Configuração e Cliente de Inferência da SLM Local Qwen 2.5 1.5B (Camada 2) | `src/sla_system/slm_client.js`, setup do `llama-server` na porta 8081 | Benchmark de inferência local com tempo < 850ms e resposta em JSON estrito |
| **Task 4** | `[PARALLEL: cloud-fallback]` | `[x] Completed` | Adapter de Fallback para Nuvem (Gemini 2.5 Flash - Camada 3) | `src/sla_system/cloud_fallback_adapter.js` | Chamada bem-sucedida caso o serviço local seja mockado como offline |
| **Task 5** | `[LEAD]` | `[x] Completed` | Construir o Módulo de SLA 5-Minutos Rei do Módulo e Integração no Gateway | `lib/reidomodulo_sla.js`, `gateway.js`, `worker.js` | Varredura da Inbox 11 do Chatwoot com detecção de SLA > 300s, suporte a áudio/imagem e link `wa.me` |
| **Task 6** | `[LEAD]` | `[x] Completed` | Bateria de Testes E2E, Validação de Build e Hard Stop | `test_sla_full_pipeline.js`, PM2 status na VPS | `npm test` verde, zero erros de compilação, e Hard Stop |

---

## 2. Detalhamento Passo a Passo

### Task 1: Confirmação Privada de Reconexão para Gerentes
- Adicionar `notifyStoreManagerResolved(store, incident)` em `projects/hydra-rede/src/reconnect_system/whatsapp_notifier.js`.
- Integrar a chamada no `watchdog_daemon.js` dentro da transição para estado `open`.
- Validar no `test_reconnect_system.js` que `notifyStoreManagerResolved` é disparado com remetente obrigatório `hydra`.

### Task 2: Regex Shield Determinístico (Camada 1)
- Criar `src/sla_system/triage_regex_shield.js`.
- Cobrir encerramentos típicos de oficinas mecânicas: *"ok"*, *"blz"*, *"valeu"*, *"show"*, *"obrigado"*, *"👍"*, *"combinado"*, *"tks"*, *"fechou"*.
- Filtrar emojis isolados.
- Detectar aceleradores de orçamento e dúvidas técnicas com interrogação e jargões.

### Task 3: Cliente de Inferência SLM Local (Qwen 2.5 1.5B)
- Configurar script de download do modelo GGUF Q4_K_M (~980MB) e comando de inicialização do `llama-server` nativo com `-t 4` e `--mlock`.
- Implementar `slm_client.js` consumindo o endpoint compatível com OpenAI `http://127.0.0.1:8081/v1/chat/completions`.
- Validar parseamento do JSON retornado (`requires_reply`, `category`, `confidence`, `reason`).

### Task 4: Fallback Cloud Adapter (Gemini Flash)
- Implementar `cloud_fallback_adapter.js` para resiliência de produção.
- Adicionar chave de alternância automática: se o `llama-server` falhar ou a resposta demorar > 2.000ms, redireciona cirurgicamente para Gemini 2.5 Flash sem interromper o SLA.

### Task 5: Módulo de SLA 5-Minutos Rei do Módulo e Integração no Gateway
- Criar `lib/reidomodulo_sla.js` espelhado no padrão comprovado de `central_sla.js`.
- Configurar em `gateway.js`:
  - Remover `11` de `IGNORED_INBOXES` (permite recepção dos eventos de webhook).
  - Manter `11` em `PROCEDURAL_AUDIT_EXCLUDED_INBOXES` (zero auditorias de elevador/vídeo de loja física).
  - Integrar os ganchos `trackIncomingReiDoModuloMessage` e `trackOutgoingReiDoModuloMessage`.
- No `worker.js`, acoplar no reconciliador de 20s a checagem das pendências do Sorted Set Redis `reidomodulo_sla:pending`.
- Tratamento automático: áudios de clientes (`att_type = 1` / `.oga`) e fotos de etiquetas/módulos (`att_type = 0`) armam o SLA diretamente.
- Despachar alerta via `hydra` com link `https://wa.me/55...`, URL do Chatwoot, trecho da mensagem e horário para os números configurados em `REIDOMODULO_SLA_TARGETS`.
- Aplicar cooldown de 45 minutos no Redis (`reidomodulo_sla:alerted:<convId>`) e persistir registro em SQLite para auditoria.

### Task 6: Bateria de Testes E2E e Hard Stop
- Executar suíte de testes unitários e de integração mockando conversas do Chatwoot.
- Validar integridade contra instâncias proibidas (assegurar que apenas `hydra` envia mensagens).
- Validar compilação estática (`node --check`).
- **HARD STOP:** Apresentar relatório de conclusão e aguardar `/vibe-archive`.

---

## 3. Protocolo de Rollback e Segurança
- Caso ocorra qualquer instabilidade de CPU na VPS, o `llama-server` pode ser imediatamente interrompido via `pm2 stop llama-server` ou `systemctl stop llama-server`, e o sistema continuará operando 100% via Camada 1 (Regex) + Camada 3 (Cloud Fallback).
- Trava de remetente incondicional: erro fatal se `sender !== 'hydra'` e `sender !== 'atendimento'`.
