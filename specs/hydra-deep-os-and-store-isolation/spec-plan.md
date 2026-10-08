# Plano de Execução — Detalhamento Profundo de OS e Isolamento de Loja

**Spec:** `hydra-deep-os-and-store-isolation`  
**Data:** 06/10/2026  
**Status:** Planejado para Implementação

---

## Tasks

### Fase 1: Extração Profunda de OS (`raw_payload`) no Banco e MCP
- [ ] `[DB]` Implementar `getDetailedOS(db, osId, lojaSlug)` em `src/hydra-sync/db_repository.ts` e `db_repository.js`, parseando serviços, peças, executores, parcelas de pagamento, documentos e checklists de `raw_payload`.
- [ ] `[MCP]` Registrar a ferramenta `get_os_details` no servidor `src/hydra-sync/mcp_server.ts` e adicionar suporte a `loja_slug` em `search_os`.
- [ ] `[RETRIEVAL]` Incluir `raw_payload` na extração de OS individual em `src/hydra-sync/hybrid_retrieval.ts`.

### Fase 2: Isolamento Estrito de Loja para Gerente (Zero Vazamento)
- [ ] `[DISPATCHER]` Blindar consultas da persona `gerente` em `src/hydra-sync/agent_dispatcher.ts`, forçando `loja_slug` da unidade em qualquer pesquisa de veículo ou OS.
- [ ] `[PROMPT]` Injetar diretiva anti-vazamento no prompt da IA para gerentes, proibindo citação de veículos de outras lojas.
- [ ] `[RESOLVER]` Garantir que buscas por modelo de carro (ex: "linea") no perfil de gerente sejam filtradas exclusivamente para a loja do gerente, sem apresentar opções de outras unidades.

### Fase 3: Eliminação de Respostas Repetitivas e Validação
- [ ] `[FORMAT]` Enriquecer o formatador de respostas para detalhar parcelas de pagamento e serviços discriminados quando solicitados pelo operador.
- [ ] `[BUILD]` Validar typecheck com `npm run typecheck:hydra` (zero erros de TypeScript).
- [ ] `[STAGING]` Sincronizar alterações com `/opt/bots/` e `/home/operacional/hydra-deploy/current/`, reiniciar no PM2 e testar com a OS #439.
