# Plano de Execução — Spec 083: Empacotamento das Frentes em Skills AGY com Orquestração Auto-Healing

## Tarefas de Implementação

- [x] [SPECIALIST:specialist-crawler-rede] **T1 — Elaboração dos Playbooks Markdown das Frentes Financeira e Operacional (Rede e Balões)**
  - Criar `projects/hydra-rede/skills/skill_rede_pipeline.md` contendo as 3 fases (Coleta/Auto-Healing, Consolidação/Selo e Disparo Matinal às 08h), instruções de limpeza de locks na porta 49222, catálogo dos 10 ECs, regra de 10x sem juros e template de mensagem.
  - Criar `projects/hydra-rede/skills/skill_baloes_diretoria.md` contendo procedimento obrigatório pré-disparo (verificação de idade dos dados do ERP e auto-healing), teste `--dry-run` anti-corrupção e templates dos Balões 1, 2 e 3.
  - **Aceite:** Ambos os arquivos criados e validados contra sintaxe Markdown e caminhos absolutos existentes no repositório.
  - **Aceite (E2E Obrigatório):** Executar validação estática de integridade garantindo que os caminhos `/home/operacional/hydra-rede/` e `/home/operacional/.venv-invisible/bin/python` constam nas skills: `node -e "const fs = require('fs'); const s1 = fs.readFileSync('./projects/hydra-rede/skills/skill_rede_pipeline.md', 'utf8'); const s2 = fs.readFileSync('./projects/hydra-rede/skills/skill_baloes_diretoria.md', 'utf8'); if (!s1.includes('.venv-invisible') || !s2.includes('120363425738307789@g.us')) throw new Error('Falha de validação'); console.log('T1_VALIDATION_PASSED');"`

- [x] [SPECIALIST:specialist-crawler-rede] **T2 — Elaboração dos Playbooks Markdown de Performance, Marketing e CRM (CMV, ROI e Reativação)**
  - Criar `projects/hydra-rede/skills/skill_performance_kpis.md` com a rotina de vigilância de mão de obra (< 45% com Anti-Spam Gate) e cobrança individual de CMV para gerentes às quartas e sextas.
  - Criar `projects/hydra-rede/skills/skill_marketing_roi.md` com o passo de sincronização de leads x OSs às 07h e envio do relatório de ROI às 08h.
  - Criar `projects/hydra-rede/skills/skill_crm_reativacao.md` com o cadenciador seguro de 4 lotes via instância `atendimento`, limites rígidos (20 clientes/dia) e jitter anti-ban (25s a 65s).
  - **Aceite:** Os 3 arquivos criados e validados com checagem de instâncias permitidas (`hydra` e `atendimento`).
  - **Aceite (E2E Obrigatório):** Executar validação estática garantindo ausência de números de gerentes como remetentes e conformidade de regras: `node -e "const fs = require('fs'); const s3 = fs.readFileSync('./projects/hydra-rede/skills/skill_performance_kpis.md', 'utf8'); const s4 = fs.readFileSync('./projects/hydra-rede/skills/skill_marketing_roi.md', 'utf8'); const s5 = fs.readFileSync('./projects/hydra-rede/skills/skill_crm_reativacao.md', 'utf8'); if (!s5.includes('atendimento') || !s3.includes('Anti-Spam') || !s4.includes('ROI Real')) throw new Error('Falha de validação'); console.log('T2_VALIDATION_PASSED');"`

- [x] [SPECIALIST:specialist-crawler-rede] **T3 — Criação do Script Gerador e Instalador Automatizado das Skills na VPS**
  - Desenvolver `projects/hydra-rede/scripts/generate_and_deploy_skills.sh` e o utilitário sincronizador correspondente.
  - O script deve provisionar idempotentemente a pasta `/home/operacional/hydra-rede/skills/` na VPS com os 5 arquivos Markdown atualizados e permissões corretas.
  - **Aceite:** Script executável criado com permissão de execução e validação de parâmetros.
  - **Aceite (E2E Obrigatório):** Executar o script de deploy na VPS (`ssh operacional@100.126.50.101`) comprovando que os 5 arquivos `.md` foram instalados em `/home/operacional/hydra-rede/skills/` com conteúdo idêntico e integridade verificada.

- [x] [LEAD] **T4 — Validação Integrada dos Playbooks, Testes de Integridade e Build Gate**
  - Executar verificação de conformidade de todas as 5 skills criadas contra as regras de governança e mensageria.
  - Executar o Build Gate do repositório (`node --check`, suíte de testes de juros e checagens estáticas).
  - Sincronizar cópia dos playbooks em `.agents/skills/` para disponibilização imediata no ambiente local do `agy`.
  - **Aceite:** Todas as 5 skills verificadas, presentes no repositório e sincronizadas na VPS.
  - **Aceite (E2E Obrigatório):** Execução física do build gate e conferência via SSH na VPS comprovando presença física dos 5 playbooks prontos para invocação pelo `agy`.
