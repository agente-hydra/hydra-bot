# Relatório de Setup de Especialistas SDD v2

- **Data:** 2026-11-04T23:12:04.688Z
- **Modo:** first-run
- **Confiança:** HIGH
- **Especialistas Instalados:** 4

## Roster Ativo
### Especialista em Crawler & Rede (`specialist-crawler-rede`)
- **Papel:** Automação de Browser, Sessão Playwright & Scraping de Agendamentos
- **Padrões:** `src/hydra-sync/*crawler*, src/hydra-sync/deep-crawler.ts, src/hydra-sync/rede*, src/hydra-sync/*session*, src/hydra-sync/*modal*, src/hydra-sync/*changebrand*, src/hydra-sync/contas_pagar_crawler.ts, src/hydra-sync/metas_crawler.ts, src/hydra-sync/relatorio_operacao_crawler.ts, src/hydra-sync/BuscaContasAPagar.xls`

### Especialista em Tempário & Resolução Semântica (`specialist-tempario-semantic`)
- **Papel:** Grafo de Serviços Mecânicos, Resolução por Placa e Sinônimos
- **Padrões:** `src/hydra-sync/*tempario*, src/hydra-sync/*semantic*, src/hydra-sync/*plate*, src/hydra-sync/*apibrasil*, src/hydra-sync/*ontology*, src/hydra-sync/*embeddings*, src/hydra-sync/*glossary*, src/hydra-sync/*synonym*, src/hydra-sync/*intent*, src/hydra-sync/*analysis*, src/hydra-sync/*decision*, src/hydra-sync/*turn*, src/hydra-sync/*case*, src/hydra-sync/*language*, tsconfig.tempario.json`

### Especialista em Mensageria WhatsApp & Ingress (`specialist-messaging-whatsapp`)
- **Papel:** Gateways Evolution API, Atendimento Conversacional e Webhook Ingress
- **Padrões:** `src/hydra-sync/*whatsapp*, src/hydra-sync/*conversation*, src/hydra-sync/*webhook*, src/hydra-sync/*balloon*, src/hydra-sync/*queue*, src/hydra-sync/*inbound*, src/hydra-sync/*presence*, src/hydra-sync/*evo*, src/hydra-sync/*chatwoot*, src/hydra-sync/*message*, src/hydra-sync/*media*, src/hydra-sync/*multimodal*, src/hydra-sync/*os_*, webhook-listener.js`

### Especialista em Ops, Deploy & Backend (`specialist-ops-infra`)
- **Papel:** Infraestrutura VPS, PM2, Banco de Dados, Testes e Automações
- **Padrões:** `deploy/**, scripts/**, tools/**, docs/**, projects/**, scratch/**, src/workers/**, src/hydra-sync/tests/**, src/hydra-sync/scripts/**, src/hydra-sync/types/**, src/hydra-sync/fixtures/**, src/hydra-sync/*db*, src/hydra-sync/*supabase*, src/hydra-sync/*finance*, src/hydra-sync/*manager*, src/hydra-sync/*mcp*, src/hydra-sync/*admin*, src/hydra-sync/*agent*, src/hydra-sync/*ai*, src/hydra-sync/*command*, src/hydra-sync/*data*, src/hydra-sync/*delta*, src/hydra-sync/*dual*, src/hydra-sync/*evidence*, src/hydra-sync/*feriados*, src/hydra-sync/*format*, src/hydra-sync/*hourly*, src/hydra-sync/*hybrid*, src/hydra-sync/*hydra*, src/hydra-sync/*idempotency*, src/hydra-sync/*identity*, src/hydra-sync/*memory*, src/hydra-sync/*operational*, src/hydra-sync/*public*, src/hydra-sync/*query*, src/hydra-sync/*real*, src/hydra-sync/*reindexar*, src/hydra-sync/*runtime*, src/hydra-sync/*transcribe*, src/hydra-sync/*sec*, src/hydra-sync/*summary*, src/hydra-sync/*system*, src/hydra-sync/*tool*, src/hydra-sync/*access*, src/hydra-sync/*better-sqlite3*, src/hydra-sync/*vault*, src/hydra-sync/*user*, package.json, package-lock.json, skills-lock.json, tsconfig.json, tsconfig.clean.json, tsconfig.hydra.json, iniciar-agy.bat, hydra_*.html, test_commands_composer.ts, test_send_node.js, list_inst.js, list_tokens.js, scratch_mcp_lead_tools.ts`

## Ações Executadas
- Determined setup mode: first-run (hash: 3e0981b766)
- Updated specialist doc: specialist-crawler-rede/SPECIALIST.md
- Created initial specialist memory: memory/specialists/specialist-crawler-rede.md
- Updated specialist doc: specialist-tempario-semantic/SPECIALIST.md
- Created initial specialist memory: memory/specialists/specialist-tempario-semantic.md
- Updated specialist doc: specialist-messaging-whatsapp/SPECIALIST.md
- Created initial specialist memory: memory/specialists/specialist-messaging-whatsapp.md
- Updated specialist doc: specialist-ops-infra/SPECIALIST.md
- Created initial specialist memory: memory/specialists/specialist-ops-infra.md
- Updated .agent/specialists/roster.lock.json
