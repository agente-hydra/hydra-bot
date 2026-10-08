# Proposta: Watchdog Sliding Idle Debounce (Janela de Inatividade)

## Contexto e Problema
O Watchdog audita conversas de gerentes e clientes do Chatwoot para identificar infrações operacionais, etapas do funil e suporte mecânico.
No código legado (`gateway.js`), a janela de acumulação utilizava `SETNX` com tempo fixo de 15 minutos a partir da PRIMEIRA mensagem do lote.

### Defeito Operacional (Fixed Window)
1. Quando uma conversa é iniciada, o cronômetro trava no timestamp `now + 15 min`.
2. Mensagens subsequentes enviadas 5, 10 ou 14 minutos depois caíam no buffer, mas NÃO prorrogavam o prazo.
3. Se o cliente ou gerente enviava uma mensagem crucial (ex: aprovação de orçamento ou esclarecimento de defeito) aos 14 minutos e 30 segundos, a análise disparava pontualmente aos 15 minutos (apenas 30 segundos após o envio), pegando o diálogo no meio do fluxo ou disparando conclusões prematuras.

## Solução Proposta
Implementar uma Janela de Inatividade Deslizante (**Sliding Idle Debounce**):
1. **Idle Gap Configurável:** 20 minutos (1200s padrão, ajustável via `WATCHDOG_IDLE_SECONDS`).
2. **Prorrogação a cada mensagem:** Cada nova mensagem (seja do cliente ou do gerente) reseta o timer no Redis (`SET debounce:conv:${convId} 1 EX remainingTtl` e atualização de score no ZSET `watchdog:scheduled_evals`).
3. **Disparo exclusivo por silêncio:** A auditoria SÓ é executada quando a conversa fica 20 minutos inteiros sem nenhuma nova mensagem.
4. **Teto Máximo de Acumulação (Ceiling):** Teto de segurança de 120 minutos (2 horas) via `debounce_start:conv:${convId}` para evitar inanição (starvation) em conversas excepcionalmente contínuas.
5. **Limpeza coordenada no Worker:** O `worker.js` limpa `debounce_start:conv:${convId}` após o término do ciclo, garantindo que o próximo lote inicie do zero.
