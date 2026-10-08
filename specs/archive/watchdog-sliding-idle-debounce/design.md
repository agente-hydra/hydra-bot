# Design Técnico: Watchdog Sliding Idle Debounce

## Arquitetura de Estado no Redis

### Chaves e Estruturas
1. `buffer:conv:${convId}` (LIST):
   - Armazena os payloads das mensagens recebidas.
   - TTL estendido: `MAX_ACCUMULATION_SECONDS + 600` (ex: 2h 10m).
2. `debounce:conv:${convId}` (STRING):
   - Chave efêmera que monitora a inatividade.
   - A cada mensagem recebida: `SET debounce:conv:${convId} 1 EX remainingTtl`.
   - Dispara notificação `__keyevent@0__:expired` quando a inatividade é atingida.
3. `debounce_start:conv:${convId}` (STRING):
   - Guarda o timestamp epoch em segundos do início do lote atual.
   - Criado com `SET ... NX EX MAX_ACCUMULATION_SECONDS + 600`.
   - Limite teto: `nextScheduledAt = min(now + IDLE_GAP, start + MAX_ACCUMULATION)`.
4. `watchdog:scheduled_evals` (ZSET):
   - Índice ordenado por score (`scheduledAt`).
   - A cada mensagem recebida: `ZADD watchdog:scheduled_evals nextScheduledAt convId`.
   - Reconciliador varre a cada 30s: `ZRANGEBYSCORE watchdog:scheduled_evals -inf now`.

## Fluxo de Processamento

```mermaid
sequenceDiagram
    participant Webhook as Chatwoot / Evolution
    participant Gateway as Watchdog Gateway (Fastify)
    participant Redis as Redis (6380)
    participant Worker as Watchdog Worker

    Webhook->>Gateway: POST /webhook (msg 1 às 10:00)
    Gateway->>Redis: SET debounce_start:conv:101 = 10:00 (NX)
    Gateway->>Redis: SET debounce:conv:101 = 1 (EX 1200s) -> 10:20
    Gateway->>Redis: ZADD watchdog:scheduled_evals 10:20 101

    Note over Gateway,Redis: Diálogo continua...
    Webhook->>Gateway: POST /webhook (msg 2 às 10:14)
    Gateway->>Redis: SET debounce:conv:101 = 1 (EX 1200s) -> 10:34 (PRORROGADO!)
    Gateway->>Redis: ZADD watchdog:scheduled_evals 10:34 101

    Note over Gateway,Redis: Conversa silenciou (Inatividade)
    Note over Redis,Worker: Às 10:34 (20 min de silêncio absoluto)
    Redis-->>Worker: Keyspace Expired / ZSET Score <= Now
    Worker->>Worker: Executa auditoria completa com Gemini/AGY
    Worker->>Redis: ZREM scheduled_evals & DEL debounce, buffer, debounce_start
```
