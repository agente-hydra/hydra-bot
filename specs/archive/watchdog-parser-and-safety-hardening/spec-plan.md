# Plano de Implementação (Spec Plan): Endurecimento de Parser e Políticas no Watchdog

---

## Tarefas de Implementação

### - [x] [JSON-EXTRACTOR] Tarefa 1: Criação do Módulo de Extração de JSON Resiliente
- **Arquivos:**
  - `/home/operacional/watchdog/lib/json_extractor.js`
  - `/home/operacional/watchdog/worker.js`
- **Ações:**
  1. Implementar `lib/json_extractor.js` com suporte a múltiplos blocos markdown ````json ````, busca reversa do último bloco válido e busca externa por delimitador `{ ... }`.
  2. Adicionar validação de payload mínimo (`isValidAuditPayload`: verifica `infracao_detectada` e `codigo_regra`).
  3. Substituir no `worker.js` a lógica frágil de `content.split('```json')[1]` pela chamada a `extractJsonFromAgyOutput(stdout)`.
- **Critério de Aceite:**
  - Respostas com stream interrompido ou múltiplos blocos ````json ```` são parseadas sem lançar `SyntaxError`.

---

### - [x] [SAFETY-SANITIZER] Tarefa 2: Módulo de Sanitização de Transcripts para IA
- **Arquivos:**
  - `/home/operacional/watchdog/lib/safety_sanitizer.js`
  - `/home/operacional/watchdog/worker.js`
- **Ações:**
  1. Criar `lib/safety_sanitizer.js` com lista calibrada de substituição de termos que disparam políticas Prohibited Use do Google.
  2. Integrar a higienização do `transcript` antes da interpolação no prompt do `worker.js`.
  3. Preservar termos comerciais e indicadores legítimos de ríspidez/descaso.
- **Critério de Aceite:**
  - Textos com palavras sensíveis têm os termos substituídos por marcadores neutros sem descaracterizar a conversa.

---

### - [x] [POLICY-TRAP] Tarefa 3: Tratamento Gracioso de Bloqueio por Política de IA
- **Arquivos:**
  - `/home/operacional/watchdog/worker.js`
- **Ações:**
  1. Detectar no callback do `agy` se a resposta contém `violates Google's [Generative AI Prohibited Use policy]` ou status `ERROR` com recusa de política.
  2. Ao detectar recusa de política:
     - Tentar uma reavaliação imediata aplicando sanitização agressiva no transcript.
     - Se persistir recusado, registrar métrica dedicada (`stats:policy_blocks`), remover da fila de retry e arquivar o registro sem loops inúteis de retries de 60s/120s.
- **Critério de Aceite:**
  - Nenhuma conversa bloqueada por política fica presa em retries infinitos.

---

### - [x] [TEST-SUITE] Tarefa 4: Suíte de Testes Automatizada
- **Arquivos:**
  - `/home/operacional/watchdog/test_watchdog_parser_hardening.js`
- **Ações:**
  1. Criar script de testes cobrindo:
     - Caso real da conversa 676 (stream interrompido com dois blocos ````json ````).
     - JSON com texto antes/depois.
     - Validação de payload de auditoria.
     - Sanitização de termos sensíveis.
  2. Executar o teste via Node.js na VPS.
- **Critério de Aceite:**
  - 100% dos testes passando na VPS.

---

### - [x] [ROLLOUT] Tarefa 5: Rollout e Validação sob PM2
- **Ações:**
  1. Fazer backup do `worker.js` atual.
  2. Recarregar `watchdog-worker` no PM2 (`pm2 reload watchdog-worker`).
  3. Inspecionar logs em tempo real (`pm2 logs watchdog-worker --lines 30`).
  4. Garantir zero regressões no consumo de conversas.
- **Critério de Aceite:**
  - Processo `watchdog-worker` operando com consumo estável de memória e logs limpos.

---

## Circuit Breakers e Travas de Segurança

1. **Hard Stop Obrigatório:** Nenhuma linha de código no Watchdog em produção é alterada nesta fase de proposta. A execução só se inicia com o comando `/sdd-apply`.
2. **Segurança de Mensageria:** Alertas continuam restritos à instância `hydra` e aos destinatários oficiais autorizados.
