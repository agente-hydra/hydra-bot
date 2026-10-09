# Proposta: Despacho Matinal 100% VPS dos 3 Relatórios Oficiais (hydra-clean-trio-dispatch)

**Spec ID:** `hydra-clean-trio-dispatch`  
**Data:** 09/10/2026  
**Status:** Planejamento  
**Ambiente:** 100% VPS Linux (`operacional@100.126.50.101`) — Zero Execução no Windows  

---

## 1. Diagnóstico do Incidente e Causa-Raiz

Na manhã de hoje (09/10/2026), o usuário relatou que em vez de receber **estritamente e apenas os 3 arquivos oficiais** (`Juros Rede`, `Carros em Pátio` e `Mapa de Metas`) sem qualquer texto no WhatsApp, ocorreram falhas críticas:
1. Foram enviadas **três mensagens com textos longos**:
   - Um balão com texto operacional de Pátio;
   - Uma planilha de Carros em Pátio;
   - Uma planilha de Juros Rede acompanhada de um texto longo de legenda (*RELATÓRIO DE JUROS E TAXAS • REDE* com detalhamento por loja).
2. **O Mapa de Metas (`Mapa de Metas - DD-MM-AAAA.pdf`) não foi enviado.**

### 1.1. Causa-Raiz Técnica Comprovada

A auditoria factual no código e nos agendadores comprovou:

1. **A Rotina Estava Rodando no Windows Local do Usuário (Anti-Pattern):**
   - No Agendador de Tarefas do Windows (`Task Scheduler`), estavam ativas as tarefas legadas:
     - `\Hydra-Patio-OS-Diario` (executando às 07:30 via `run_patio_reconciliation.bat`).
     - `\Hydra-Rede-Juros-Diario` (executando às 07:50 via `run_juros_rede.bat`).
   - Esses scripts locais rodavam de forma concorrente e disparavam mensagens com textos:
     - `run_patio_daily.js` rodou sem `--clean`, caindo no bloco que dispara 1 texto de resumo executivo + 1 Excel.
     - `index.js` gerou o Excel de Juros e disparou com a legenda longa `formatarMensagemHydra`.
2. **Por que o Mapa de Metas não foi enviado:**
   - O PDF oficial (`Mapa de Metas - 09-10-2026.pdf`) **já havia sido gerado com sucesso pelo crawler na VPS** às 03:43 em `/home/operacional/hydra-data/crawls/Mapa de Metas - 09-10-2026.pdf`.
   - Como os scripts locais do Windows eram os responsáveis pelo envio matinal, e nenhum deles buscava o PDF na VPS nem sabia da existência dele, o Mapa de Metas simplesmente não foi disparado.

---

## 2. Solução Proposta: Migração e Execução 100% na VPS

### 2.1. Desativação Compulsória de Tarefas no Windows Local
- Remover definitivamente do Agendador de Tarefas do Windows:
  - `schtasks /delete /tn "Hydra-Patio-OS-Diario" /f`
  - `schtasks /delete /tn "Hydra-Rede-Juros-Diario" /f`
- Neutralizar os arquivos `.bat` locais (`run_patio_reconciliation.bat`, `run_juros_rede.bat`) para que nunca mais disparem mensagens de WhatsApp a partir da máquina do usuário.

### 2.2. Orquestrador Único e Centralizado na VPS Linux (`/home/operacional/hydra-rede`)
Toda a rotina matinal passa a ser executada **exclusivamente na VPS**:
- Script orquestrador na VPS: `/home/operacional/hydra-rede/scripts/run-unified-morning.sh` invocando `node src/run_unified_morning_dispatch.js`:
  1. **Geração de Juros da Rede:** Executa `node src/index.js --build-only` diretamente na VPS, gerando `/home/operacional/hydra-rede/output/Juros Rede - DD-MM-AAAA.xlsx`.
  2. **Geração de Carros em Pátio:** Executa `node src/run_patio_daily.js --build-only` diretamente na VPS, consumindo os crawls já existentes e gerando `/home/operacional/hydra-rede/output/relatorios/Carros em Patio - DD-MM-AAAA.xlsx`.
  3. **Resolução do Mapa de Metas:** Localiza o PDF oficial já gerado na madrugada em `/home/operacional/hydra-data/crawls/Mapa de Metas - DD-MM-AAAA.pdf`.
  4. **Verificação de Totalidade (3/3 Arquivos):** Valida a presença física e o tamanho dos 3 arquivos no disco da VPS. Se faltar qualquer um, aborta o envio à diretoria e dispara alerta de erro para o desenvolvedor (`DEV_NUMBER: 5511996242812`).
  5. **Timer Guard na VPS:** Aguarda pontualmente até as 08:00:00 AM (suporta `--immediate` para testes).
  6. **Trava de Idempotência na VPS:** Checa `/home/operacional/hydra-data/locks/matinal_dispatch_${YYYY-MM-DD}.lock` para impedir disparo duplicado.
  7. **Despacho Silencioso via Evolution API:** Envia sequencialmente os 3 arquivos oficiais com `caption: ""` e **zero mensagens de texto no chat**.

### 2.3. Agendamento Único no Crontab da VPS
No `crontab -e` do usuário `operacional` na VPS:
```cron
# Disparo Matinal Unificado dos 3 Relatórios Oficiais (07:45 AM -> Disparo 08:00 AM)
45 7 * * 1-5 /home/operacional/hydra-rede/scripts/run-unified-morning.sh >> /home/operacional/hydra-data/logs/matinal-trio.log 2>&1
```

---

## 3. Contratos dos 3 Arquivos Oficiais

| Relatório | Caminho na VPS | Nome Canônico | MIME Type |
|---|---|---|---|
| **Juros e Taxas da Rede** | `/home/operacional/hydra-rede/output/` | `Juros Rede - DD-MM-AAAA.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| **Carros em Pátio & OS** | `/home/operacional/hydra-rede/output/relatorios/` | `Carros em Patio - DD-MM-AAAA.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| **Mapa de Metas Oficial** | `/home/operacional/hydra-data/crawls/` | `Mapa de Metas - DD-MM-AAAA.pdf` | `application/pdf` |

**Regra de Ouro da Entrega:** O WhatsApp da diretoria recebe exclusivamente os 3 documentos acima anexados, sem nenhum texto solto antes ou depois, e com o campo `caption` estritamente vazio.

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Tarefas do Windows continuarem rodando em paralelo | Disparo duplicado | Remoção explícita via `schtasks /delete` e neutralização dos scripts `.bat` locais |
| Crawler noturno atrasar ou falhar em 1 loja | Mapa de Metas ausente na VPS | O orquestrador detecta a ausência, bloqueia o envio à diretoria e alerta o `DEV_NUMBER` imediatamente |
| Concorrência de locks na VPS | Script bloqueado | Execução às 07:45 AM, fora da janela do crawler noturno das 03:15 AM |
