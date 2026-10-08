#!/usr/bin/env bash
set -e
TS=$(date +%Y%m%d_%H%M%S)

echo "==> 1. Criando backup..."
cp -r /opt/bots/src/hydra-sync "/home/operacional/backup_sync_$TS"
cp /home/operacional/hydra/webhook-listener.js "/home/operacional/hydra/webhook-listener.js.bak_$TS"

echo "==> 2. Sincronizando arquivos integrados de staging para /opt/bots/ e /home/operacional/hydra/..."
cp -r /home/operacional/hydra-staging/src/hydra-sync/* /opt/bots/src/hydra-sync/
if [ -d /home/operacional/hydra-staging/scripts ]; then
  mkdir -p /home/operacional/hydra/scripts /opt/bots/scripts
  cp -r /home/operacional/hydra-staging/scripts/* /home/operacional/hydra/scripts/ 2>/dev/null || true
  cp -r /home/operacional/hydra-staging/scripts/* /opt/bots/scripts/ 2>/dev/null || true
fi
cp /home/operacional/hydra-staging/webhook-listener.js /home/operacional/hydra/webhook-listener.js
cp /home/operacional/hydra-staging/webhook-listener.js /opt/bots/webhook-listener.js
if [ -f /home/operacional/hydra-staging/webhook-listener.d.ts ]; then
  cp /home/operacional/hydra-staging/webhook-listener.d.ts /opt/bots/webhook-listener.d.ts
  cp /home/operacional/hydra-staging/webhook-listener.d.ts /home/operacional/hydra/webhook-listener.d.ts 2>/dev/null || true
fi

echo "==> 3. Verificando typecheck em /opt/bots..."
cd /opt/bots && npx tsc --project tsconfig.hydra.json --noEmit

echo "==> 4. Recarregando hydra-bot no PM2..."
pm2 reload hydra-bot

echo "==> 5. Deploy concluído com sucesso!"
