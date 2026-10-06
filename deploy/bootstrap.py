#!/usr/bin/env python3
"""One-time installation on the original VPS. Does not print credential values."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

BASE = Path('/home/operacional/hydra-deploy')
SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hydra_sync', SOURCE / 'deploy' / 'sync.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
sync.BASE = BASE

LINKS = [
    {'path': '/opt/bots/src/hydra-sync', 'relative': 'src/hydra-sync'},
    {'path': '/opt/bots/src/workers/oficina-agent', 'relative': 'src/workers/oficina-agent'},
    {'path': '/home/operacional/hydra/webhook-listener.js', 'relative': 'webhook-listener.js'},
    {'path': '/home/operacional/hydra/scripts/run-hydra-hourly-finance.sh', 'relative': 'scripts/run-hydra-hourly-finance.sh'},
    {'path': '/home/operacional/hydra/scripts/run-hydra-daily-full.sh', 'relative': 'scripts/run-hydra-daily-full.sh'},
    {'path': '/opt/bots/docs/app-map/empresas.json', 'relative': 'docs/app-map/empresas.json'},
    {'path': '/home/operacional/hydra/docs/app-map/empresas.json', 'relative': 'docs/app-map/empresas.json'},
    {'path': '/opt/bots/scripts/run-hydra-hourly-finance.sh', 'relative': 'scripts/run-hydra-hourly-finance.sh'},
    {'path': '/opt/bots/scripts/run-hydra-daily-full.sh', 'relative': 'scripts/run-hydra-daily-full.sh'},
    {'path': '/opt/bots/scripts/run-agy-sec.sh', 'relative': 'scripts/run-agy-sec.sh'},
    {'path': '/opt/bots/scripts/run-hydra-auditor.sh', 'relative': 'scripts/run-hydra-auditor.sh'},
    {'path': '/opt/bots/scripts/oauth_sec_daemon.py', 'relative': 'scripts/oauth_sec_daemon.py'},
    {'path': '/opt/bots/scripts/hydra_health_check.ts', 'relative': 'scripts/hydra_health_check.ts'},
]


def selected(name):
    return name.startswith(('OI_', 'OFICINA_', 'EVOLUTION_', 'CHATWOOT_', 'HYDRA_', 'AGY_', 'WORKER_')) or name in ['TZ', 'PORT']


def private_environment(manifest):
    values = {}
    envfile = Path('/opt/bots/.env')
    for line in envfile.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1); key = key.strip().removeprefix('export '); value = value.strip()
        if selected(key):
            if value.startswith('"') and value.endswith('"'):
                try: value = json.loads(value)
                except ValueError: value = value[1:-1]
            elif value.startswith("'") and value.endswith("'"):
                value = value[1:-1]
            values[key] = value
    for entry in manifest['files']:
        if not entry['path'].endswith(('.ts', '.js')) or '/tests/' in entry['path']:
            continue
        text = Path(entry['source']).read_text()
        for match in re.finditer(r'process\.env\.([A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|PASS|SECRET)[A-Z0-9_]*)\s*\|\|\s*([\x22\x27])([^\x22\x27]+)\2', text):
            values.setdefault(match[1], match[3])
    # Preserve effective overrides from the current PM2 process, without exporting them.
    processes = json.loads(subprocess.run(['/usr/bin/pm2', 'jlist'], capture_output=True, text=True, check=True).stdout)
    bot = next(p for p in processes if p['name'] == 'hydra-bot')
    for item in Path('/proc/' + str(bot['pid']) + '/environ').read_bytes().split(b'\0'):
        if b'=' in item:
            key, value = item.decode(errors='replace').split('=', 1)
            if selected(key): values[key] = value
    values.setdefault('TZ', 'America/Sao_Paulo')
    private = BASE / 'shared' / '.env'
    private.parent.mkdir(parents=True, exist_ok=True)
    if not private.exists():
        private.write_text(''.join(key + '=' + json.dumps(value, ensure_ascii=False) + '\n' for key, value in sorted(values.items())))
    private.chmod(0o600)
    print('Private Hydra configuration prepared; no values exported')


def install():
    if (BASE / 'config.json').exists():
        raise RuntimeError('Installation already configured; use sync.py')
    manifest = json.loads((SOURCE / 'docs' / 'production-baseline.json').read_text())
    for entry in manifest['files']:
        original = Path(entry['source'])
        if not original.is_file() or hashlib.sha256(original.read_bytes()).hexdigest() != entry['sha256']:
            raise RuntimeError('Production changed since capture: ' + entry['path'])
    BASE.mkdir(mode=0o700, exist_ok=True)
    BASE.chmod(0o700)
    for name in ['releases', 'manifests', 'legacy-paths']:
        (BASE / name).mkdir(exist_ok=True)
    private_environment(manifest)
    legacy = BASE / 'releases' / 'legacy-before-git'
    legacy.mkdir(exist_ok=True)
    for entry in manifest['files']:
        destination = legacy / entry['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(entry['source'], destination)
    (legacy / 'node_modules').symlink_to('/opt/bots/node_modules', target_is_directory=True)
    (legacy / '.env').symlink_to(BASE / 'shared' / '.env')
    # This initial pointer preserves original code while stable production paths are registered.
    sync.atomic_link(BASE / 'current', legacy)
    config = {'repository': 'mktfun/hydra-bot', 'links': LINKS}
    installed = []
    with sync.lock_file(BASE / 'deploy.lock'), sync.lock_file('/tmp/hydra-data-refresh.lock'):
        try:
            for item in LINKS:
                link = Path(item['path'])
                # Legacy docs may already be an alias of /opt/bots/docs; do not operate twice.
                if link.is_symlink() and os.readlink(link) == str(BASE / 'current' / item['relative']):
                    continue
                backup = BASE / 'legacy-paths' / item['path'].lstrip('/')
                backup.parent.mkdir(parents=True, exist_ok=True)
                link.parent.mkdir(parents=True, exist_ok=True)
                if link.exists() or link.is_symlink():
                    if backup.exists() or backup.is_symlink():
                        raise RuntimeError('A legacy backup already exists: ' + str(backup))
                    link.rename(backup)
                installed.append((link, backup))
                link.symlink_to(BASE / 'current' / item['relative'], target_is_directory=(legacy / item['relative']).is_dir())
            sync.write_json(BASE / 'config.json', config)
            shutil.copy2(SOURCE / 'deploy' / 'sync.py', BASE / 'sync.py')
        except Exception:
            for link, backup in reversed(installed):
                if link.is_symlink(): link.unlink()
                if backup.exists() or backup.is_symlink(): backup.rename(link)
            raise
    print('Original production files retained; compatibility paths installed')


if __name__ == '__main__':
    install()
