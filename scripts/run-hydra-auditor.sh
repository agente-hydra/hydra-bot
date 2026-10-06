#!/bin/bash
set -e

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /opt/bots

# Trava de concorrência para evitar duas execuções simultâneas
exec 200>/tmp/hydra-auditor.lock
flock -n 200 || {
  echo "[Hydra Runner] Já existe uma execução em andamento. Abortando."
  exit 0
}

mkdir -p /home/operacional/hydra-data/crawls
mkdir -p /home/operacional/hydra-data/backups
LOG_FILE="/home/operacional/hydra-data/auditor.log"

DIA_SEMANA=$(date +%u) # 1=Seg, 7=Dom
HORA_ATUAL=$(date +%-H)
HOJE_STR=$(date +%Y-%m-%d)

# Domingo nunca roda
if [ "$DIA_SEMANA" -eq 7 ]; then
  echo "[Hydra Runner] Domingo: rotina desativada." >> "$LOG_FILE"
  exit 0
fi

# Se for modo catch-up (ex: chamado no reboot)
if [ "$1" == "--catch-up" ]; then
  echo "[Hydra Runner] Verificando necessidade de catch-up pós-boot em $(date)..." >> "$LOG_FILE"
  PRECISA_RODAR=0
  
  # Se passou das 06:00 e não rodou hoje
  if [ "$HORA_ATUAL" -ge 6 ] && [ "$HORA_ATUAL" -lt 14 ]; then
    if ! grep -qE "Disparo.*$HOJE_STR.*0[6-8]:" "$LOG_FILE" 2>/dev/null; then
      PRECISA_RODAR=1
      echo "[Hydra Runner] Rodada matinal (06:00) foi perdida. Disparando catch-up agora." >> "$LOG_FILE"
    fi
  fi

  # Se passou das 14:00 (Seg a Sex) e não rodou a tarde
  if [ "$HORA_ATUAL" -ge 14 ] && [ "$DIA_SEMANA" -le 5 ]; then
    if ! grep -q "Disparo.*$HOJE_STR.*1[4-9]:" "$LOG_FILE" 2>/dev/null; then
      PRECISA_RODAR=1
      echo "[Hydra Runner] Rodada vespertina (14:00) foi perdida. Disparando catch-up agora." >> "$LOG_FILE"
    fi
  fi

  if [ "$PRECISA_RODAR" -eq 0 ]; then
    echo "[Hydra Runner] Nenhuma rodada perdida hoje. Tudo em dia." >> "$LOG_FILE"
    exit 0
  fi
fi

# Define flags de execução (garante --send-whatsapp caso não seja --preview)
EXTRA_FLAGS=""
if [[ ! " $@ " =~ " --preview " ]] && [[ ! " $@ " =~ " --send-whatsapp " ]]; then
  EXTRA_FLAGS="--send-whatsapp"
fi

echo "================================================================" >> "$LOG_FILE"
echo "Disparo: $(date)" >> "$LOG_FILE"
/usr/bin/node ./node_modules/tsx/dist/cli.mjs src/hydra-sync/hydra_auditor_service.ts $EXTRA_FLAGS "$@" >> "$LOG_FILE" 2>&1
echo "Conclusão: $(date)" >> "$LOG_FILE"
