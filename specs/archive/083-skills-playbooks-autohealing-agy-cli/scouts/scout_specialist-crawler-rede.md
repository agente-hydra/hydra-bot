---
specialistId: specialist-crawler-rede
specId: 083-skills-playbooks-autohealing-agy-cli
complexity: medium
anchors: ["projects/hydra-rede/src/index.js:1", "projects/hydra-rede/src/run_group_balloon_dispatch.js:1", "projects/hydra-rede/src/run_cmv_kpi_gerentes.js:1", "projects/hydra-rede/scripts/run-unified-morning.sh:1"]
---

# Scout: Playbooks em Skills AGY com Orquestração Auto-Healing

## Diagnóstico
1. **Fragilidade de Execuções Cegas no Cron:** Atualmente, os crons disparam scripts bash ou nós pontuais (`run-nightly-prep.sh`, `run_group_balloon_dispatch.js`, etc.) de forma cega. Se o portal oscilar, houver lock de porta zumbi (TCP 49222), atraso no clearing S3 da Rede ou defasagem nos JSONs de pátio do ERP, o script falha silenciosamente ou envia dados parciais.
2. **Potencial de Orquestração com Antigravity CLI (`agy`):** O agente dispõe de capacidade de auditoria ativa, auto-healing determinístico e decisão antes de executar o passo seguinte. Empacotar as 5 frentes operacionais em Skills (`.md`) homologadas permite que o `agy` audite pré-requisitos, saneie o ambiente e garanta 100% de integridade antes dos envios.
3. **Necessidade de Automação de Instalação e Sincronização:** Os playbooks precisam existir em diretório padronizado (`projects/hydra-rede/skills/` e `.agents/skills/`), acompanhados de script gerador e wrappers executáveis para cron na VPS.

## Recomendações
1. Estruturar 5 Skills especializadas (`skill_rede_pipeline.md`, `skill_baloes_diretoria.md`, `skill_performance_kpis.md`, `skill_marketing_roi.md`, `skill_crm_reativacao.md`) com gatilhos, regras de segurança de mensageria e rotinas de auto-healing.
2. Criar utilitário gerador e instalador determinístico (`scripts/generate_and_deploy_skills.sh` ou `.js`) para provisionar os arquivos na árvore do projeto e na VPS (`/home/operacional/hydra-rede/skills/`).
3. Criar wrappers de orquestração para execução autônoma pelo `agy cli` com verificação de pré-condições (Golden Gate, locks, frescor de dados e selos de auditoria).
4. Validar determinismo e integridade estática de todos os playbooks e comandos.
