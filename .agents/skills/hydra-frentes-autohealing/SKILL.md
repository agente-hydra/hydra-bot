---
name: hydra-frentes-autohealing
description: Orquestrador autônomo e auto-healing para as 5 frentes operacionais do Hydra (Rede 05h-08h, Pátio ERP & Balões WhatsApp 08h-19h, Alertas de CMV & Mão de Obra, Marketing & ROI, e CRM de Reativação). Realiza pré-auditoria determinística, correção de locks e dados defasados, e garante integridade antes de qualquer disparo.
metadata:
  version: "1.0.0"
  role: "specialist-crawler-rede"
  scope: "orchestration-autohealing"
---

# Skill: hydra-frentes-autohealing

Orquestrador e sentinela auto-healing para as rotinas financeiras, operacionais e de mensageria das 10 lojas automotivas da rede Mecânica Popular / Hydra.

## 1. Visão Geral das 5 Frentes e Playbooks

Os playbooks completos estão disponíveis em `projects/hydra-rede/skills/` e na VPS em `/home/operacional/hydra-rede/skills/`:

| Playbook | Frente Operacional | Janelas de Atuação | Canal & Destinatário |
|---|---|---|---|
| `skill_rede_pipeline.md` | Coleta, Auditoria e Envio Rede | 05:00, 06:00, 07:00, 08:00 | Financeiro (+55 11 94066-7032) & Davi |
| `skill_baloes_diretoria.md` | Pátio ERP & Balões Executivos | 08:00, 09:00, 14:00, 15:00, 19:00 | Grupo Sócios (`120363425738307789@g.us`) |
| `skill_performance_kpis.md` | Alertas CMV e Mão de Obra (< 45%) | 10:30-20:30 (30m) e Qua/Sex 14h | Grupo Sócios & Privado dos Gerentes |
| `skill_marketing_roi.md` | Leads x OSs & Relatório de ROI | 07:00 e 08:00 | Grupo da Diretoria |
| `skill_crm_reativacao.md` | Cadenciamento CRM Anti-Ban | 09:15, 11:15, 14:15, 16:15 | Clientes Inativos da Base via `atendimento` |

## 2. Princípios de Auto-Healing Mandatórios

1. **Auditoria Antes da Ação:** Nunca enviar mensagens ou consolidar arquivos sem checagem de pré-requisitos (tamanho > 0, 10/10 lojas presentes, dados de ERP atualizados há menos de 60 min).
2. **Correção Autônoma de Locks:** Ao identificar contenção na porta TCP 49222 ou zumbis no perfil Firefox, aplicar `pkill -f rede_invisible_worker.py` e remover o arquivo `.lock` imediatamente.
3. **Simulação Prévia (--dry-run):** Balões executivos devem ser previamente simulados com `--dry-run` para assegurar que nenhum valor `NaN` ou `undefined` seja transmitido.
4. **Regra de Segurança de Mensageria:** Disparos utilizam estritamente as instâncias autorizadas `hydra` e `atendimento`. Proibição absoluta de uso de números ou instâncias de gerentes de loja.
