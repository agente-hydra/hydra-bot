# Design Técnico: Endurecimento do Harness do Agente Hydra

## 1. Arquitetura Geral do Sistema

O subsistema de mensagens da Hydra opera em arquitetura de microsserviço Node.js/TypeScript executado sob PM2 (`hydra-bot`) na VPS Linux (`operacional@100.126.50.101`). O pipeline de processamento consiste em:

```
[ Evolution API Webhook ]
           │
           ▼
[ webhook-listener.js ] ──► (Validação HTTP, Dedup SQLite, Reação 👀 imediata em <15ms)
           │
           ▼ (Async exec / spawn)
[ agent_dispatcher.ts ]
     ├── 1. Fast-Path Determinístico (SQL SQLite WAL <80ms)
     │       ├── Auditoria de Checklists por Loja (`getChecklistAudit`)
     │       ├── Pátio & Aging por Loja (`getPatioOverview`)
     │       └── Consultas de Metas / Financeiro Direto
     │
     ├── 2. Resolução de Veículo / OS (Parser Regex + Anáfora)
     │       ├── Extração de Modelo Expandida (Ka, C3, Spin, etc.)
     │       ├── Extração de OS direta e pareada (`ka 465`, `polo 22631`)
     │       └── Precedência Estrita do Turno Atual (Zero vazamento de `prevOsId`)
     │
     └── 3. Roteamento de IA Assíncrono (`dual_worker_router.ts`)
             ├── Worker Primário (Gemini Direct API)
             └── Worker Secundário (CLI `agy` via `spawn` não-bloqueante)
```

---

## 2. Detalhamento dos Componentes

### Componente 1: Execução Assíncrona Não-Bloqueante (`dual_worker_router.ts`)

#### Problema Atual
No método `executeCliWorker`, a invocação do executável CLI (`agy`) utiliza `spawnSync`:
```typescript
const proc = spawnSync(bin, args, { cwd: '/opt/bots', timeout: worker.timeoutMs, ... });
```
Durante os 15 a 45 segundos de execução do modelo pela CLI, a thread do Node.js é 100% bloqueada. Isso congela o listener de webhooks, atrasa reações 👀 e causa timeout em healthchecks.

#### Solução Arquitetural
Refatorar para função auxiliar assíncrona `spawnCliAsync` utilizando `child_process.spawn`:
```typescript
interface SpawnCliResult {
  stdout: string;
  stderr: string;
  status: number | null;
  durationMs: number;
  timedOut: boolean;
  error?: Error;
}

function spawnCliAsync(
  bin: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
): Promise<SpawnCliResult>
```
- **Fluxo de Eventos:**
  1. Cria processo filho com `spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })`.
  2. Coleta buffers parciais de `stdout.on('data')` e `stderr.on('data')`.
  3. Configura `setTimeout` para o teto de timeout (`options.timeoutMs`).
  4. Se o timer disparar antes de `close`, sinaliza `child.kill('SIGTERM')`. Se não encerrar em 1500ms, emite `child.kill('SIGKILL')`.
  5. No evento `child.on('close', (code) => ...)`, limpa o timer e resolve a Promise com telemetria detalhada.

---

### Componente 2: Parser Semântico de Veículos e OS (`agent_dispatcher.ts`)

#### Problema Atual
1. O regex de modelos reconhecidos possui apenas uma lista restrita:
   ```typescript
   const modelMatch = textoLimpo.match(/\b(linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|renegate|kwid|argo|cronos|polo|virtus|t-cross|creta|tracker|kicks)\b/i);
   ```
   Modelos frequentes na oficina como **Ka**, **C3**, **Spin**, **Etios**, **Duster**, **Sandero**, **Tucson** não são reconhecidos.
2. O regex de OS exige obrigatoriamente a palavra `os` ou `ordem`:
   ```typescript
   const osMatch = textoLimpo.match(/\b(?:os|ordem)\s*#?\s*(\d{1,6})\b/i);
   ```
   Quando o operador digita `"detalhes do ka 465"`, `osMatch` é nulo.
3. Fallback perigoso para o turno anterior:
   ```typescript
   const currentOsId = osMatch ? osMatch[1] : (prevOsId || inferredOsId);
   ```
   Como nem o modelo nem a OS foram capturados, o dispatcher assumiu `prevOsId` (OS 458 de um Citroën C3), gerando resposta alucinada/trocada.

#### Solução Arquitetural
1. **Dicionário Expandido de Modelos:**
   ```typescript
   const VEHICLE_MODELS_REGEX = /\b(ka|c3|c4|spin|etios|sandero|duster|tucson|focus|sonic|voyage|fox|up|clio|cruze|cobalt|prisma|siena|strada|saveiro|montana|toro|hilux|ranger|s10|amarok|amaroq|linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|renegate|kwid|argo|cronos|polo|virtus|t-cross|creta|tracker|kicks|fit|city|wrv|hrv|hr-v|yaris)\b/i;
   ```
2. **Parser Pareado Modelo + Número de OS:**
   - Se o texto contiver `[modelo] [número de 2 a 6 dígitos]` (ex: `"ka 465"`, `"polo 22631"`):
     - `targetModel = "ka"`
     - `targetOsId = "465"`
     - `isExplicitInCurrentTurn = true`
3. **Regra de Precedência Estrita:**
   - Se o turno atual possui um número ou modelo explícito, **PROIBIDO** herdar `prevOsId` ou `prevVehicleModel` do turno anterior. O contexto anterior só é herdado quando a mensagem atual é uma anáfora pura sem entidades novas (ex: `"e o valor dele?"`, `"quando sai?"`).

---

### Componente 3: Rota Rápida Determinística SQL para Checklists e Pátio

#### Problema Atual
Consultas como `"quais estao sem checklist de entrada? liste por loja"` ou `"carros em patio dom pedro"` demoram 90s no LLM, estouram o timeout e retornam mensagem de erro genérica.

#### Solução Arquitetural
Intercetar intenções operacionais de checklist e pátio antes de chamar o LLM:
1. **Identificadores de Intenção:**
   - Checklist: `sem checklist|checklist pendente|auditoria de checklist|checklist de entrada`
   - Pátio: `carros em patio|veiculos no patio|aging do patio|retidos`
2. **Execução Direta em SQLite WAL:**
   - Chamar `getChecklistAudit(db, lojaSlug)` diretamente.
   - Formatar resposta via `formatChecklistAuditSummary(result)`.
   - Salvar a conversa e o estado do turno normalmente no SQLite.
   - Responder em menos de **80 milissegundos**.

---

### Componente 4: Higienização de Ingress HTTP no Webhook (`webhook-listener.js`)

#### Problema Atual
Em `webhook-listener.js`:
```javascript
const payload = JSON.parse(body);
...
} catch (err) {
  console.error("[Hydra Webhook] Erro no processamento do payload:", err);
  res.writeHead(500, { "Content-Type": "text/plain" }).end("internal_error");
}
```
Payloads malformados causam `SyntaxError`, respondem com HTTP 500 e provocam retries infinitos da Evolution API.

#### Solução Arquitetural
Tratar explicitamente `SyntaxError` retornando `HTTP 400 Bad Request`:
```javascript
} catch (err) {
  if (err instanceof SyntaxError) {
    console.warn("[Hydra Webhook] ⚠️ Payload JSON inválido recebido no ingress:", err.message);
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({
      status: "bad_request",
      error: "Malformed JSON payload"
    }));
    return;
  }
  console.error("[Hydra Webhook] Erro no processamento do payload:", err);
  res.writeHead(500, { "Content-Type": "text/plain" }).end("internal_error");
}
```

---

## 3. Estratégia de Delegação por Subagentes

Para garantir máxima velocidade e foco isolado com verificação centralizada:

1. **Subagente 1 (Async Router Specialist):**
   - Foco: `src/hydra-sync/dual_worker_router.ts`
   - Implementa `spawnCliAsync` e integra ao `executeCliWorker`.
   - Adiciona testes de não-bloqueio e controle de timeout em `tests/test_async_spawn_router.ts`.

2. **Subagente 2 (Semantic & Anaphora Specialist):**
   - Foco: `src/hydra-sync/agent_dispatcher.ts`
   - Expande regex de modelos de veículos.
   - Implementa parser pareado modelo + OS e trava de precedência estrita.
   - Cria teste de regressão para `"detalhes do ka 465"` em `tests/test_vehicle_anaphora_resolution.ts`.

3. **Subagente 3 (Fast SQL & Deterministic Dispatch Specialist):**
   - Foco: `src/hydra-sync/agent_dispatcher.ts` e `src/hydra-sync/db_repository.ts`
   - Conecta intercepção de checklist e pátio direto para funções SQL.
   - Valida formatação dos balões e latência (<80ms).

4. **Subagente 4 (Webhook Ingress & Error Trapping Specialist):**
   - Foco: `webhook-listener.js`
   - Trata `SyntaxError` com HTTP 400.
   - Valida tolerância a falhas e comportamento do ciclo de vida de mensagens.

5. **Agente Orquestrador (Antigravity):**
   - Executa `git status` e `git diff` para inspecionar o trabalho de cada subagente.
   - Executa `tsc --noEmit` como compiler gate.
   - Executa os testes automatizados na VPS.
   - Roda `deploy_to_prod.sh` e verifica status do PM2 (`hydra-bot`).
