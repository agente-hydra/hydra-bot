# Proposta Técnica: Endurecimento do Harness do Agente Hydra (Async Execution, Resolução de Intenções e Rotas Rápidas)

## 1. Problema Identificado

Durante a auditoria operacional e de logs em tempo real na VPS (`operacional@100.126.50.101`), foram diagnosticadas três fragilidades críticas no agente de mensagens:

1. **Bloqueio do Event Loop com `spawnSync` no Router da IA (`dual_worker_router.ts`):**
   - A chamada à CLI de IA (`agy`) era executada com `spawnSync` síncrono.
   - Em consultas analíticas complexas que demoram de 15 a 40 segundos, **todo o processo Node.js do webhook fica completamente congelado**. Webhooks subsequentes da Evolution API não eram recebidos a tempo, acumulando latência e retries.
2. **Bug de Resolução de Modelo e Anáfora de OS (`agent_dispatcher.ts`):**
   - Mensagem real do usuário: `"detalhes do ka 465"`.
   - O modelo `ka` não constava no regex de modelos conhecidos e o número `465` não vinha precedido da palavra "os" ou "ordem".
   - O dispatcher ignorou o número digitado pelo usuário e caiu em fallback silencioso para a OS do turno anterior (`prevOsId` = 458, C3), retornando informações do veículo errado!
3. **Timeouts Globais de 90s em Consultas Analíticas por Loja:**
   - Consultas como `"quais estao sem checklist de entrada? liste por loja"` e `"carros em patio dom pedro"` demoraram mais de 90 segundos (`90.614ms` e `90.706ms`), estourando o teto orçamentário e disparando fallbacks genéricos de timeout (`H-IA-02`).
   - Todos esses dados já existem no SQLite operacional (`hydra_ops.db`), podendo ser respondidos em menos de **80ms** via queries determinísticas especializadas sem sobrecarregar a IA.
4. **Respostas HTTP 500 em Payloads com JSON Inválido no Webhook:**
   - O `webhook-listener.js` emitia `HTTP 500` ao capturar `SyntaxError` de JSON quebrado, fazendo com que o remetente (Evolution API) fizesse retries em loop.

---

## 2. Solução Proposta

1. **Substituição de `spawnSync` por `spawn` Assíncrono com Promise:**
   - No `dual_worker_router.ts`, refatorar `executeCliWorker` para usar `spawn()` não-bloqueante com `Promise`, acumulando stdout/stderr em buffers e tratando timeout com `setTimeout` + `kill()`.
   - O event loop do Node.js permanece 100% responsivo para atender webhooks enquanto a IA processa em segundo plano.
2. **Correção do Parser de Modelos e Alvos de OS:**
   - Expandir a lista de modelos reconhecidos para incluir veículos populares da oficina (`ka`, `c3`, `etios`, `spin`, `duster`, `sandero`, `tucson`, `focus`, `sonic`, `voyage`, etc.).
   - Capturar qualquer número de 2 a 6 dígitos quando acompanhado de modelo ou termos de OS (`ka 465`, `polo 22631`).
   - Priorizar **estritamente** o número digitado no turno atual sobre qualquer OS inferida de turnos anteriores.
3. **Rotas Rápidas Determinísticas para Auditoria de Checklists e Pátio:**
   - Implementar funções determinísticas em SQL para resolver consultas de conformidade de checklists por loja e aging por loja em `< 80ms`.
4. **Higienização de Ingress HTTP no Webhook Listener:**
   - Retornar `HTTP 400 Bad Request` com `{ status: "invalid_json" }` para payloads malformados, encerrando tentativas de retry desnecessárias.

---

## 3. Contratos de Dados & Interfaces

### Nova Assinatura Assíncrona de Execução de CLI
```typescript
interface CliExecutionOptions {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

interface CliExecutionResult {
  stdout: string;
  stderr: string;
  status: number | null;
  durationMs: number;
  timedOut: boolean;
}
```

### Contrato de Extração de OS / Modelo
```typescript
interface VehicleTargetExtraction {
  osId?: string;
  plate?: string;
  model?: string;
  isExplicitInCurrentTurn: boolean;
}
```

---

## 4. Risco Principal e Mitigação

- **Risco:** Processos `agy` ficarem órfãos (*zombie processes*) na VPS caso o timeout assíncrono seja acionado.
- **Mitigação:** Implementar encerramento em cascata via `process.kill(-child.pid, 'SIGKILL')` ou `child.kill('SIGKILL')` associado ao evento de timeout e ao evento `exit` do Node.js.
