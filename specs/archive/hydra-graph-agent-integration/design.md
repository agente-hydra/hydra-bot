# Design Técnico: Integração do Grafo de Atendimentos nas Buscas do Hydra Agent & Presença Contínua WhatsApp

## 1. Arquitetura e Fluxo de Dados

```
                      ┌────────────────────────────────────────┐
                      │      Entrada: Mensagem do Usuário      │
                      └──────────────────┬─────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │ Início do Job: InFlightAbortRegistry       │
                   │ Ativação: PresenceHeartbeatKeeper.start() │ ◀── Pulso contínuo a cada 4s
                   └─────────────────────┬─────────────────────┘     ("digitando..." estável)
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │ Classificação de Rota (agent_dispatcher)   │
                   └──────────┬──────────────────────┬─────────┘
                              │                      │
             [Alvo Específico: Placa/OS/Modelo]      │ [Pergunta Aberta / Follow-up]
                              ▼                      ▼
            ┌──────────────────────────────────┐   ┌──────────────────────────────────┐
            │ Fast-Path: hybrid_os_coordinator │   │ Agente Autônomo AGY CLI (LLM)    │
            │                                  │   │                                  │
            │ resolveCaseContext(db, order)    │   │ Tools MCP:                       │
            │   ├── 1. Projeção de Grafo       │   │   ├── get_os_case_history        │
            │   ├── 2. Análise Canônica        │   │   └── get_os_details (enriquecida│
            │   └── 3. Fallback Direto ERP     │   └────────────────┬─────────────────┘
            └─────────────────┬────────────────┘                    │
                              │                                     │
                              ▼                                     ▼
                   ┌─────────────────────┴─────────────────────┐
                   │ Parada: PresenceHeartbeatKeeper.stop()    │ ◀── Desliga antes do envio
                   └─────────────────────┬─────────────────────┘
                                         │
                                         ▼
                   ┌───────────────────────────────────────────┐
                   │ Envio Sequencial de Balões (WhatsApp)     │
                   └───────────────────────────────────────────┘
```

## 2. Componente de Presença: `PresenceHeartbeatKeeper`

### Motivação Técnica
A Evolution API e o protocolo do WhatsApp expiram o estado `composing` após ~2 a 5 segundos. Um envio pontual no início do webhook deixa o usuário 10 a 25 segundos sem indicador visual de atividade enquanto ferramentas de banco e LLM processam. O `PresenceHeartbeatKeeper` mantém um intervalo vivo com pulso recorrente e proteção rigorosa contra vazamento de memória ou travamento.

### Implementação Recomendada (`src/hydra-sync/presence_heartbeat.ts`):
```typescript
export interface PresenceSender {
  sendPresence(phone: string, presence: 'composing' | 'paused', delayMs?: number): Promise<void>;
}

export class PresenceHeartbeatKeeper {
  private static instance: PresenceHeartbeatKeeper;
  private activeTimers: Map<string, { intervalId: NodeJS.Timeout; timeoutId: NodeJS.Timeout }> = new Map();

  public static getInstance(): PresenceHeartbeatKeeper {
    if (!PresenceHeartbeatKeeper.instance) {
      PresenceHeartbeatKeeper.instance = new PresenceHeartbeatKeeper();
    }
    return PresenceHeartbeatKeeper.instance;
  }

  public start(phone: string, sender: PresenceSender, intervalMs: number = 4000, maxDurationMs: number = 60000): void {
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone) return;

    this.stop(cleanPhone);

    // Disparo imediato inicial
    sender.sendPresence(cleanPhone, 'composing', intervalMs).catch(() => {});

    // Heartbeat periódico
    const intervalId = setInterval(() => {
      sender.sendPresence(cleanPhone, 'composing', intervalMs).catch(() => {});
    }, intervalMs);

    // Trava de segurança (teto máximo)
    const timeoutId = setTimeout(() => {
      this.stop(cleanPhone);
    }, maxDurationMs);

    this.activeTimers.set(cleanPhone, { intervalId, timeoutId });
  }

  public stop(phone: string): void {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const entry = this.activeTimers.get(cleanPhone);
    if (entry) {
      clearInterval(entry.intervalId);
      clearTimeout(entry.timeoutId);
      this.activeTimers.delete(cleanPhone);
    }
  }
}
```

---

## 3. Integração com o Grafo de Atendimentos

### A. `src/hydra-sync/hybrid_os_coordinator.ts`
- **Atualização:** Conectar a função `getCaseContext(db, order)` diretamente ao leitor de fatos `resolveCaseContext(db, order)` exportado por [`case_memory_reader.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/case_memory_reader.ts).
- **Comportamento:**
  - Substitui a inspeção ingênua de `raw_payload.motivo_demora`.
  - Quando a OS tiver projeção válida em `hydra_case_graph_projections` ou `hydra_case_current_position`, o retorno trará `evidenceOrigin = 'GRAPH_PROJECTION'` com motivo documentado e próximo passo prometido.
  - Se a OS não tiver análise, preserva a declaração honesta de limitação factual (`evidenceOrigin = 'ERP_DIRECT'`, `isLimitationDeclared = true`).

### B. `src/hydra-sync/mcp_server.ts`
- **Ferramenta 1 (Nova): `get_os_case_history`**
  - Exposta no servidor MCP `hydra-ops-sqlite-mcp`.
  - Assinatura:
    ```typescript
    {
      name: 'get_os_case_history',
      description: 'Retorna a posição consolidada do histórico de atendimento e do grafo da Ordem de Serviço: aprovação de orçamento pelo cliente, saldo de peças pendentes, motivo documentado de atraso e compromissos acordados no WhatsApp.',
      inputSchema: {
        type: 'object',
        properties: {
          os_id: {
            type: 'string',
            description: 'Número da Ordem de Serviço (obrigatório, ex: "501")'
          },
          loja_slug: {
            type: 'string',
            description: 'Slug da loja (opcional, para desambiguação e validação de segurança)'
          }
        },
        required: ['os_id']
      }
    }
    ```
- **Ferramenta 2 (Atualizada): `get_os_details`**
  - Mantém o retorno completo existente de serviços, peças e pagamentos.
  - Adiciona o campo opcional `historico_atendimento` gerado via `resolveCaseContext`, permitindo que chamadas genéricas da LLM já tenham visibilidade de atrasos e compromissos.

### C. `src/hydra-sync/db_repository.ts`
- **Garantia de Schema:** No boot do banco (`initSchema`), invocar explicitamente `ensureCaseAnalysisTables(db)` para garantir que as tabelas `hydra_case_analyses` e `hydra_case_graph_projections` existam no SQLite antes de qualquer consulta.

### D. `src/hydra-sync/agent_dispatcher.ts`
- **Diretriz de Ferramentas:** Atualizar a seção `# DIRETRIZ DE ATENDIMENTO` do prompt operacional para informar à IA sobre `get_os_case_history`:
  - Instruir a LLM a chamar `get_os_case_history` sempre que o usuário perguntar *"por que tá demorando?"*, *"o que foi falado pro cliente?"*, *"quando fica pronto?"* ou pedir histórico de negociação da OS.

---

## 4. Matriz de Segurança e RBAC

| Perfil do Usuário | Permissão na Ferramenta | Comportamento Cross-Store |
| :--- | :--- | :--- |
| **Sócio (`socio`)** | Leitura irrestrita em todas as lojas | Acesso a qualquer `loja_slug` da rede. |
| **Gerente (`gerente`)** | Leitura estrita da sua loja autorizada | Bloqueio imediato (`SecurityAccessDeniedError`) se consultar OS de outra unidade. |
| **Não Autenticado** | Bloqueio imediato | Rejeição antes da chamada de banco. |

---

## 5. Estratégia de Testes

Criar suíte automatizada `src/hydra-sync/tests/test_agent_graph_search.ts` cobrindo 6 gates determinísticos:
1. **Gate 1 (Presença Contínua):** `PresenceHeartbeatKeeper` dispara pulsos estáveis a cada 4s e encerra com precisão no `stop()`.
2. **Gate 2 (Fast-Path Integrado):** `getCaseContext` recupera motivo de atraso do grafo para OS com projeção sem reler mensagens.
3. **Gate 3 (Ferramenta MCP `get_os_case_history`):** Execução da tool retorna JSON estruturado com status de aprovação e saldo de peças.
4. **Gate 4 (Retrocompatibilidade `get_os_details`):** Detalhes da OS incluem bloco de histórico sem quebrar a estrutura existente.
5. **Gate 5 (Regra de Ouro Factual):** OS sem análise retorna limitação honesta sem alucinar falta de peças.
6. **Gate 6 (Isolamento RBAC):** Consulta de gerente para loja externa é terminantemente bloqueada.
