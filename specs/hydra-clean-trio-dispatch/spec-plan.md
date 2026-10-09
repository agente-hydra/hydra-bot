# Plano de Implementação — Despacho Matinal 100% VPS (hydra-clean-trio-dispatch)

**Spec ID:** `hydra-clean-trio-dispatch`  
**Data:** 09/10/2026  
**Status:** Implementado & Homologado com Sucesso  
**Ambiente:** 100% VPS Linux (`operacional@100.126.50.101`)  

---

## Critérios Obrigatórios de Aceite

- [x] **[ZERO_WINDOWS_EXECUTION]** Nenhuma rotina matinal roda no Windows do usuário. As tarefas agendadas no Task Scheduler do Windows foram sumariamente deletadas.
- [x] **[ZERO_TEXT_IN_CHAT]** Proibição absoluta de mensagens de texto ou resumos executivos enviados para o chat.
- [x] **[ZERO_CAPTIONS]** Os 3 arquivos são enviados com `caption: ""` via Evolution API.
- [x] **[ALL_THREE_REPORTS_VPS]** Os 3 arquivos oficiais são gerados e validados na VPS antes do envio:
  1. `/home/operacional/hydra-rede/output/Juros Rede - DD-MM-AAAA.xlsx`
  2. `/home/operacional/hydra-rede/output/relatorios/Carros em Patio - DD-MM-AAAA.xlsx`
  3. `/home/operacional/hydra-data/crawls/Mapa de Metas - DD-MM-AAAA.pdf`
- [x] **[AUTONOMOUS_VPS_CRON]** O crontab da VPS orquestra o processo às 07:45 AM com Timer Guard até às 08:00:00 AM de forma autônoma (mesmo com o PC do usuário desligado).
- [x] **[SAFE_DEV_ALERTS]** Em caso de ausência de qualquer um dos 3 relatórios na VPS, o envio é cancelado e o desenvolvedor (`DEV_NUMBER: 5511996242812`) é alertado imediatamente.
- [x] **[DRY_RUN_VALIDATED]** Homologação executada diretamente na VPS com envio para o telefone exclusivo (`5511996242812`) comprovando o recebimento de apenas os 3 documentos sem textos e zero envio ao financeiro.

---

## Fase 1: Desativação Completa no Windows
- [x] **[TASK_DELETE_WINDOWS_SCHTASKS]** Executar remoção das tarefas no Windows:
  - `schtasks /delete /tn "Hydra-Patio-OS-Diario" /f` [CONCLUÍDO]
  - `schtasks /delete /tn "Hydra-Rede-Juros-Diario" /f` [CONCLUÍDO]
- [x] **[TASK_NEUTRALIZE_BAT]** Atualizar `run_patio_reconciliation.bat` e `run_juros_rede.bat` para emitir aviso e abortar execução local. [CONCLUÍDO]

---

## Fase 2: Ajustes de Construção Silenciosa na VPS (`--build-only`)
- [x] **[TASK_BUILD_ONLY_JUROS]** Em `projects/hydra-rede/src/index.js`:
  - Suportar `--build-only` para apenas gerar `Juros Rede - DD-MM-AAAA.xlsx` sem acionar disparos de WhatsApp. [CONCLUÍDO]
- [x] **[TASK_BUILD_ONLY_PATIO]** Em `projects/hydra-rede/src/run_patio_daily.js`:
  - Suportar `--build-only` para apenas construir `Carros em Patio - DD-MM-AAAA.xlsx` sem disparos. [CONCLUÍDO]

---

## Fase 3: Orquestrador Matinal Único na VPS
- [x] **[TASK_CREATE_ORCHESTRATOR]** Criar `projects/hydra-rede/src/run_unified_morning_dispatch.js`:
  - Geração local na VPS dos 2 Excels.
  - Verificação de presença do `Mapa de Metas - DD-MM-AAAA.pdf` em `/home/operacional/hydra-data/crawls/`.
  - Gate de Totalidade: Se não houver 3/3 arquivos válidos (> 5KB cada), aborta e notifica o Dev.
  - Timer Guard: Aguarda pontualmente 08:00:00 AM (suporta `--immediate`).
  - Disparo sequencial dos 3 documentos com `caption: ""` via `dispararRelatoriosMatinaisSilenciosos`.
  - Lock de Idempotência: Grava `/home/operacional/hydra-data/locks/matinal_${dateTagBR}.lock`.
  - Destinatário Exclusivo: Configurado estritamente para `5511996242812` (Financeiro Desativado). [CONCLUÍDO]
- [x] **[TASK_CREATE_SHELL_SCRIPT]** Criar `projects/hydra-rede/scripts/run-unified-morning.sh` na VPS com permissão de execução (`chmod +x`). [CONCLUÍDO]

---

## Fase 4: Configuração do Crontab na VPS
- [x] **[TASK_UPDATE_VPS_CRON]** Atualizar crontab do usuário `operacional` na VPS:
  - Adicionar entrada diária das 07:45 AM apontando para `run-unified-morning.sh`.
  - Desacoplar o crawler das 03:15 do script legado de pátio. [CONCLUÍDO]

---

## Fase 5: Homologação e Testes na VPS
- [x] **[TASK_TEST_DRY_RUN_VPS]** Executar teste direto na VPS:
  - `node src/run_unified_morning_dispatch.js --immediate --force`
  - Validado recebimento no celular do desenvolvedor (`5511996242812`) dos 3 arquivos sem nenhuma mensagem de texto e zero envio ao financeiro. [CONCLUÍDO]
