# Design Técnico — Spec 083: Arquitetura de Skills AGY com Orquestração Auto-Healing

## 1. Topologia de Skills e Fluxo de Execução

```
+-----------------------------------------------------------------------------------+
|                           FLUXO DE EXECUÇÃO AGY AUTO-HEALING                      |
|                                                                                   |
|  [CRONTAB / DISPARO AGENDADO]                                                     |
|          │                                                                        |
|          ▼                                                                        |
|  [AGY CLI — Antigravity Agent] ───> Carrega a Skill correspondente (.md)          |
|                                                                                   |
|  FASE 1: AUDITORIA DE PRÉ-CONDIÇÕES                                               |
|  • Sessão ativa? Porta 49222 livre? Locks presos?                                 |
|  • Dados do ERP atualizados há menos de 60 minutos?                               |
|  • Existem 10/10 arquivos baixados no diretório downloads/?                       |
|          │                                                                        |
|          ├──> [SE ANOMALIA DETECTADA] ──> AUTO-HEALING AUTÔNOMO:                  |
|          │                                • Mata processos órfãos e limpa locks   |
|          │                                • Dispara extração das lojas faltantes  |
|          │                                • Força atualização imediata do ERP     |
|          ▼                                                                        |
|  FASE 2: CONSOLIDAÇÃO & PROCESSAMENTO                                             |
|  • Aplica regras comerciais (ex: matriz 10x sem juros)                            |
|  • Emite selo criptográfico de aprovação                                          |
|  • Executa simulação --dry-run (trava contra strings corrompidas)                 |
|          │                                                                        |
|          ▼                                                                        |
|  FASE 3: DISPARO SEGURO VIA WHATSAPP                                              |
|  • Gatekeeper valida selo APPROVED                                                |
|  • Envio exclusivamente via instâncias 'hydra' ou 'atendimento'                   |
|  • Transmissão dos arquivos ou balões com log determinístico                      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Estrutura dos Arquivos de Skill (`skills/`)

Todos os playbooks serão organizados no repositório em `projects/hydra-rede/skills/` e replicados na VPS em `/home/operacional/hydra-rede/skills/`:

### 2.1. `skill_rede_pipeline.md`
- **Papel:** Orquestrador do coletor, auditoria contábil e envio dos relatórios da Rede.
- **Janela:** 05:00 AM (coleta), 06:00 AM (auto-healing), 07:00 AM (auditoria) e 08:00 AM (disparo).
- **Auto-Healing:** Detecta locks de porta 49222, finaliza processos zumbis, reexecuta extração para lojas faltantes e impede disparo sem selo.
- **Mensageria:** 5 relatórios ao Financeiro (`+55 11 94066-7032`) e Conciliação ao Davi via instância `hydra`.

### 2.2. `skill_baloes_diretoria.md`
- **Papel:** Orquestrador de pátio ERP e balões executivos do WhatsApp.
- **Janela:** 08:00 AM (Balão 2 Full), 09:00 AM (Balão 1 Pátio), 14:00 PM (Balão 2 Simples), 15:00 PM (Balão 1 Atualizado) e 19:00 PM (Balão 3 Fechamento).
- **Auto-Healing:** Compara timestamp dos arquivos `os_store_*.json` e banco `hydra_ops.db`. Se > 60 min ou dados zerados, roda `run-hydra-hourly-finance.sh` antes de disparar. Executa `--dry-run` para barrar mensagens com `NaN` ou `undefined`.
- **Mensageria:** Grupo dos Sócios (`120363425738307789@g.us`) via instância `hydra`.

### 2.3. `skill_performance_kpis.md`
- **Papel:** Guardião de margem (CMV) e proporção de mão de obra.
- **Janela:** A cada 30 min entre 10:30 e 20:30 (Serviço Prestado) e Quartas/Sextas às 14:00 PM (CMV Gerentes).
- **Auto-Healing:** Aplica Anti-Spam Gate de disparo único diário por loja.
- **Mensageria:** Grupo dos Sócios (serviço prestado < 45%) e privado dos gerentes (CMV alto) via instância `hydra`.

### 2.4. `skill_marketing_roi.md`
- **Papel:** Auditor de marketing, reconciliação de leads com OSs e ROI de Google Ads.
- **Janela:** 07:00 AM (sincronização) e 08:00 AM (disparo do ROI).
- **Auto-Healing:** Validação de payload e retry automático com timeout de 2 minutos.
- **Mensageria:** Grupo da Diretoria via instância `hydra`.

### 2.5. `skill_crm_reativacao.md`
- **Papel:** Cadenciador seguro de reativação de clientes antigos.
- **Janela:** 09:15, 11:15, 14:15 e 16:15.
- **Auto-Healing:** Checagem de conectividade da instância `atendimento` e cadenciamento estrito com jitter anti-ban (25s a 65s).
- **Mensageria:** Clientes da base via instância `atendimento`.

---

## 3. Utilitário Gerador e Instalador Automatizado

Criar script provisionador com execução idempotente:
- **Caminho:** `projects/hydra-rede/scripts/generate_and_deploy_skills.sh`
- **Comportamento:**
  1. Cria os diretórios `skills/` local e remotamente via SSH/SCP.
  2. Escreve cada um dos 5 arquivos Markdown com permissões `644`.
  3. Valida a integridade dos arquivos via checksum MD5/SHA-256.
  4. Configura os scripts wrappers para integração com o agendador.
