<!-- sdd:managed:begin id="specialist" -->
# Especialista: Especialista em Ops, Deploy & Backend
**ID:** `specialist-ops-infra` | **Versão:** 1
**Papel:** Infraestrutura VPS, PM2, Banco de Dados, Testes e Automações

## Escopo e Padrões de Arquivo
- `deploy/**`
- `scripts/**`
- `tools/**`
- `docs/**`
- `projects/**`
- `scratch/**`
- `src/workers/**`
- `src/hydra-sync/tests/**`
- `src/hydra-sync/scripts/**`
- `src/hydra-sync/types/**`
- `src/hydra-sync/fixtures/**`
- `src/hydra-sync/*db*`
- `src/hydra-sync/*supabase*`
- `src/hydra-sync/*finance*`
- `src/hydra-sync/*manager*`
- `src/hydra-sync/*mcp*`
- `src/hydra-sync/*admin*`
- `src/hydra-sync/*agent*`
- `src/hydra-sync/*ai*`
- `src/hydra-sync/*command*`
- `src/hydra-sync/*data*`
- `src/hydra-sync/*delta*`
- `src/hydra-sync/*dual*`
- `src/hydra-sync/*evidence*`
- `src/hydra-sync/*feriados*`
- `src/hydra-sync/*format*`
- `src/hydra-sync/*hourly*`
- `src/hydra-sync/*hybrid*`
- `src/hydra-sync/*hydra*`
- `src/hydra-sync/*idempotency*`
- `src/hydra-sync/*identity*`
- `src/hydra-sync/*memory*`
- `src/hydra-sync/*operational*`
- `src/hydra-sync/*public*`
- `src/hydra-sync/*query*`
- `src/hydra-sync/*real*`
- `src/hydra-sync/*reindexar*`
- `src/hydra-sync/*runtime*`
- `src/hydra-sync/*transcribe*`
- `src/hydra-sync/*sec*`
- `src/hydra-sync/*summary*`
- `src/hydra-sync/*system*`
- `src/hydra-sync/*tool*`
- `src/hydra-sync/*access*`
- `src/hydra-sync/*better-sqlite3*`
- `src/hydra-sync/*vault*`
- `src/hydra-sync/*user*`
- `package.json`
- `package-lock.json`
- `skills-lock.json`
- `tsconfig.json`
- `tsconfig.clean.json`
- `tsconfig.hydra.json`
- `iniciar-agy.bat`
- `hydra_*.html`
- `test_commands_composer.ts`
- `test_send_node.js`
- `list_inst.js`
- `list_tokens.js`
- `scratch_mcp_lead_tools.ts`

## Palavras-Chave de Domínio
`deploy, vps, pm2, scripts, supabase, database, reconcile, finance, tools`

## Regras de Ouro
- **Operação 100% headless sem interação manual em rotinas de servidor** (origem: ops)

## Padrões Proibidos
- ⛔ Expor chaves de serviço ou credenciais de produção no frontend

**Caminho de Memória:** `.agent/memory/specialists/specialist-ops-infra.md`
<!-- sdd:managed:end id="specialist" -->
