# Proposta de Engenharia — Spec 083: Empacotamento das Frentes em Skills AGY com Orquestração Auto-Healing

## 1. Problema e Motivação

Atualmente, as rotinas operacionais da Rede, Pátio, Balões, CRM e Marketing na VPS (`100.126.50.101`) operam ancoradas em chamadas clássicas de `crontab`. Esse modelo tradicional apresenta vulnerabilidades críticas:

1. **Execução Cega e Falha Silenciosa:** Se o portal Meu Rede oscilar durante a madrugada, se um daemon Python deixar lock preso na porta TCP 49222, ou se o crawler do ERP Oficina Inteligente sofrer atraso de extração, os scripts em bash/Node falham silenciosamente ou chegam ao momento do disparo com dados parciais ou corrompidos.
2. **Dependência de Intervenção Manual de Emergência:** Quando uma anomalia ocorre, exige-se intervenção manual de um operador humano (inspeção SSH, verificação de logs, reinicialização de serviços).
3. **Ausência de Padronização para Agentes Autônomos:** Não existiam playbooks executáveis padronizados no formato de **Skills / System Prompts (`.md`)** para que o `agy cli` assuma a governança das tarefas como um **orquestrador auto-healing**.

---

## 2. Solução Proposta

Estruturar formalmente e empacotar todas as frentes em **5 Skills / Playbooks Markdown (`.md`)** calibrados para execução direta pelo `agy cli` ou via agendador inteligente:

1. **`skill_rede_pipeline.md` (Coleta, Auto-Healing e Disparo da Rede — 05h às 08h):**
   - Checagem prévia de sessão e limpeza de locks zumbis da porta 49222.
   - Extração das 10 lojas na fila S3 (`homologated_contingency_collector.py` no venv 0.45).
   - Golden Gate de integridade das 10 lojas.
   - Consolidação com matriz 10x sem juros e emissão do selo `rede_audit_passed_DD-MM-AAAA.json`.
   - Disparo pontual às 08:00 AM para o Financeiro (5 relatórios) e Davi (Conciliação) via instância `hydra`.

2. **`skill_baloes_diretoria.md` (Pátio ERP e Balões WhatsApp da Diretoria — 08h, 09h, 14h, 15h, 19h):**
   - Validação mandatória pré-disparo: checagem de timestamp dos JSONs `os_store_*.json` e banco `hydra_ops.db`. Se defasado (> 60 min), dispara o crawler antes do envio.
   - Simulação `--dry-run` para impedir envio de strings com `NaN` ou `undefined`.
   - Balão 2 Completo (08h), Balão 1 Matinal e Vespertino (09h e 15h), Balão 2 Simplificado (14h) e Balão 3 Fechamento (19h) no grupo dos sócios.

3. **`skill_performance_kpis.md` (Guardião de Margem CMV e Mão de Obra — 10:30 às 20:30):**
   - Monitor de Mão de Obra (< 45% do faturamento) com Anti-Spam Gate no grupo dos sócios.
   - Cobrança individual de CMV de peças para gerentes de loja às quartas e sextas às 14h via instância `hydra`.

4. **`skill_marketing_roi.md` (Auditor de Marketing, Leads x OSs e ROI — 07h e 08h):**
   - Sincronização diária Planilha de Leads x OSs abertas no ERP às 07h.
   - Disparo do Relatório Diário de ROI e Captação de Google Ads às 08h.

5. **`skill_crm_reativacao.md` (Cadenciador Seguro de Reativação CRM — 09:15, 11:15, 14:15, 16:15):**
   - Disparo controlado de 4 lotes de 5 clientes (máx 20/dia) inativos há mais de 6 meses.
   - Remetente exclusivo instância `atendimento` com jitter humano de 25s a 65s (anti-ban).

6. **Utilitário Gerador e Instalador Automatizado:**
   - Criar `projects/hydra-rede/scripts/generate_and_deploy_skills.sh` (e versão Node.js idempotente) para provisionar os playbooks tanto no repositório (`projects/hydra-rede/skills/` e `.agents/skills/`) quanto na VPS (`/home/operacional/hydra-rede/skills/`).

---

## 3. Especialistas Envolvidos

- **Líder (Single-Agent Orchestrator):** Governança SDD, arquitetura dos playbooks, script gerador/instalador e build gate.
- **`specialist-crawler-rede`:** Especialista em rotinas de extração, tolerância a falhas, reconciliação e validação das skills na VPS.

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Envio incorreto de mensagens por instâncias de gerentes | Violação da Regra de Ouro WhatsApp | Todas as 5 skills possuem travas explícitas e imutáveis limitando o envio unicamente a `hydra` e `atendimento`. |
| Execução concorrente de múltiplos comandos auto-healing | Colisão em locks de arquivo | Inclusão de verificação de processos e locks em cada playbook antes de acionar a recuperação. |
| Invocação de interpretador incorreto | Falha de módulos Playwright | As skills fixam explicitamente o caminho `/home/operacional/.venv-invisible/bin/python`. |
