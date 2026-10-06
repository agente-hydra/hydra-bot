#!/usr/bin/env python3
"""Deploy validated Hydra commits. No GitHub token or customer data is required."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

BASE = Path(os.environ.get('HYDRA_DEPLOY_ROOT', '/home/operacional/hydra-deploy'))
IGNORED = {'.env', '.auth', 'state', 'downloads', 'node_modules', '__pycache__', '.git', '.migration', '.superpowers'}
OBSERVE_SECONDS = 600
STARTUP_GRACE_SECONDS = 90
MAX_CHECK_GAP = 150
FAILURE_LIMIT = 3
HISTORY_LIMIT = 5
CRAWLER_LOCK = '/tmp/hydra-data-refresh.lock'

# Pure runtime path: no ERP, WhatsApp, AI calls or production database access.
FUNCTIONAL_PROBE = """
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const load=p=>import(pathToFileURL(process.cwd()+'/'+p).href);
const intent=await load('src/hydra-sync/intent_rewriter.ts');
const composer=await load('src/hydra-sync/balloon_composer.ts');
assert.equal(intent.normalizarTexto('  SITUAÇÃO  '),'situacao');
const range=intent.getCivilDateRange30Days(new Date('2026-10-06T12:00:00Z'));
assert.equal(range.startDateIso,'2026-09-07 00:00:00');
assert.equal(range.endDateIso,'2026-10-06 23:59:59');
const query=intent.rewriteIntent('faturamento da rede');
assert.equal(query.interpretation.scope,'network');
assert.ok(query.canonicalQuestion.toLowerCase().includes('faturamento'));
const text='Consulta sintética de disponibilidade interna.';
const balloons=composer.composeSemanticBalloons({directAnswer:text});
assert.deepEqual(balloons,[text]);
console.log('FUNCTIONAL_OK');
"""


def epoch(value):
    return datetime.fromisoformat(value).timestamp()


def fallback_sha(state):
    candidates = [state.get('lastHealthy')] + state.get('healthyHistory', [])
    return next((sha for sha in candidates if sha and sha != state.get('current')
                 and sha not in state.get('rejected', [])), None)


def reject_release(state, sha, reason):
    rejected = state.setdefault('rejected', [])
    if sha not in rejected:
        rejected.append(sha)
    state.update(failed=sha, lastError=reason)


def observe_health(state, report, now):
    """Advance persistent policy using one local sample; never infer unseen uptime."""
    previous_check = state.get('lastHealth', {}).get('at')
    if previous_check is not None and (now < previous_check or now - previous_check > MAX_CHECK_GAP):
        state.pop('healthySince', None)
        state['healthFailures'] = 0
    if report['ok'] and state.get('lastUptime', 0) > report.get('uptime', 0):
        state.pop('healthySince', None)
    if report.get('restarts', 0) > state.get('lastRestarts', report.get('restarts', 0)):
        report = dict(report, ok=False, reason='process_restarted')
    state['lastUptime'] = report.get('uptime', 0)
    state['lastRestarts'] = report.get('restarts', state.get('lastRestarts', 0))
    state['lastHealth'] = {'at': now, 'ok': report['ok'], 'reason': report['reason']}
    if report['ok']:
        state['healthFailures'] = 0
        state.setdefault('healthySince', now)
        if state.get('phase') == 'stable':
            return 'stable'
        if now - state['healthySince'] >= OBSERVE_SECONDS and report.get('uptime', 0) >= OBSERVE_SECONDS:
            sha = state['current']
            history = [sha] + [s for s in state.get('healthyHistory', []) if s != sha and s not in state.get('rejected', [])]
            retired = list(dict.fromkeys(state.get('retiredHealthy', []) + history[HISTORY_LIMIT:]))
            state.update(lastHealthy=sha, healthyHistory=history[:HISTORY_LIMIT],
                         retiredHealthy=retired, phase='stable', stableAt=now)
            return 'promote'
        return 'observe'
    state.pop('healthySince', None)
    if now - epoch(state.get('deployedAt', datetime.now(timezone.utc).isoformat())) < STARTUP_GRACE_SECONDS:
        state['healthFailures'] = 0
        return 'observe'
    state['healthFailures'] = state.get('healthFailures', 0) + 1
    if state['healthFailures'] >= FAILURE_LIMIT:
        return 'rollback' if fallback_sha(state) and not state.get('rollbackAttempted') else 'incident'
    return 'observe'


def validate_sha(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('Expected an exact Git commit SHA')
    return value


def fingerprint(root):
    result = {}
    for base, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED)
        for name in sorted(names):
            if name in IGNORED or name.endswith('.pyc'):
                continue
            file = Path(base) / name
            result[file.relative_to(root).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
    return dict(sorted(result.items()))


def find_drift(root, expected):
    actual = fingerprint(root)
    return sorted(p for p in set(expected) | set(actual) if expected.get(p) != actual.get(p))


@contextmanager
def lock_file(path):
    import fcntl
    with Path(path).open('a') as file:
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def atomic_link(link, target):
    temporary = link.with_name(link.name + '.next')
    if temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(target, target_is_directory=target.is_dir())
    os.replace(temporary, link)


def activate(current, target, restart, health, commit=lambda: None):
    previous = current.resolve() if current.exists() else None
    atomic_link(current, target)
    try:
        restart()
        if not health():
            raise RuntimeError('Post-deploy health check failed')
        commit()
    except Exception:
        if previous is not None:
            atomic_link(current, previous)
            restart()
            if not health():
                raise RuntimeError('Rollback restored code but its health check failed')
        raise
    return previous


def run(args, cwd=None, env=None, timeout=900):
    result = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        # Tool output stays in a private VPS log, never in the repository.
        with (BASE / 'command-errors.log').open('ab') as log:
            log.write(result.stdout[-40000:])
        raise RuntimeError('Command failed: ' + args[0] + ' (see private command-errors.log)')
    return result.stdout.decode(errors='replace').strip()


def write_json(path, value):
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temporary, path)


def listener_ready(data):
    listener = data.get('listener', {})
    return isinstance(listener, dict) and listener.get('status') == 'online'


def database_ready():
    try:
        output = run(['node', '--input-type=module', '-e', "import{createRequire}from'module';const r=createRequire(process.cwd()+'/package.json');const D=r('better-sqlite3');const db=new D('/home/operacional/hydra-data/hydra_ops.db',{readonly:true,fileMustExist:true});if(db.prepare('SELECT 1 AS ready').get().ready!==1)process.exit(1);db.close();console.log('DB_OK');"], cwd=BASE / 'current', timeout=10)
        return output == 'DB_OK'
    except Exception:
        return False


def functional_ready(root):
    try:
        return run(['node', '--import', 'tsx', '--input-type=module', '-e', FUNCTIONAL_PROBE], cwd=root, timeout=20).endswith('FUNCTIONAL_OK')
    except Exception:
        return False


def probe_health():
    report = {'ok': False, 'reason': 'listener_unavailable', 'uptime': 0}
    try:
        with urllib.request.urlopen('http://127.0.0.1:3333/health', timeout=3) as response:
            data = json.load(response)
        if response.status != 200 or not listener_ready(data):
            return report
        report['uptime'] = float(data['listener'].get('uptime', 0))
        # Read metadata internally; never write the PM2 environment into status/logs.
        processes = json.loads(run(['/usr/bin/pm2', 'jlist'], timeout=10))
        bot = next((p for p in processes if p.get('name') == 'hydra-bot'), None)
        if not bot or bot.get('pm2_env', {}).get('status') != 'online':
            return dict(report, reason='process_offline')
        report['restarts'] = bot['pm2_env'].get('restart_time', 0)
        if not database_ready():
            return dict(report, reason='database_unavailable')
        if not functional_ready(BASE / 'current'):
            return dict(report, reason='functional_probe_failed')
        return dict(report, ok=True, reason='ready')
    except (OSError, ValueError, RuntimeError, TypeError, KeyError, subprocess.TimeoutExpired):
        return report


def health_check():
    deadline = time.monotonic() + 45
    for _ in range(20):
        if probe_health()['ok']:
            return True
        if time.monotonic() >= deadline:
            break
        time.sleep(1)
    return False


def install_controller(root):
    temporary = BASE / 'sync.next.py'
    temporary.write_bytes((root / 'deploy' / 'sync.py').read_bytes())
    os.replace(temporary, BASE / 'sync.py')


def prune_retired(state):
    """Only prune retired certified code directories, never data or arbitrary paths."""
    protected = {state.get('current'), state.get('previous'), state.get('lastHealthy')} | set(state.get('healthyHistory', []))
    remaining = []
    for sha in state.get('retiredHealthy', []):
        validate_sha(sha)
        root = BASE / 'releases' / sha
        manifest = BASE / 'manifests' / (sha + '.json')
        if sha in protected or root.is_symlink() or root.resolve().parent != (BASE / 'releases').resolve():
            remaining.append(sha)
            continue
        if root.is_dir():
            if not manifest.exists() or find_drift(root, json.loads(manifest.read_text())):
                remaining.append(sha)
                continue
            shutil.rmtree(root)
        manifest.unlink(missing_ok=True)
    state['retiredHealthy'] = remaining


def finish_healthy_rollback(state, target, reason):
    """Never hop back to rejected code when recovery itself fails."""
    atomic_link(BASE / 'current', target)
    try:
        restart_bot()
        recovered = health_check()
    except Exception:
        recovered = False
    state.update(recoveryBlocked=not recovered, phase='observing' if recovered else 'incident',
                 incident=None if recovered else 'Fallback also failed; automatic version hopping stopped',
                 rollbackReason=reason, healthFailures=0)
    write_json(BASE / 'status.json', state)
    refresh_mcp_sessions()
    (BASE / 'pending.json').unlink(missing_ok=True)
    print('Rollback recovered: ' + state['current'] if recovered else state['incident'])
    return state


def bot_busy():
    try:
        with urllib.request.urlopen('http://127.0.0.1:3333/health', timeout=3) as response:
            listener = json.load(response).get('listener', {})
        if listener.get('queueSize', 1) or listener.get('activeChats', 1) or listener.get('isProcessing', True):
            return True
    except (OSError, ValueError):
        pass  # A missing listener cannot drain a queue; still protect live dispatchers.
    for pid in Path('/proc').iterdir():
        if pid.name.isdigit():
            try:
                if any(arg.endswith(b'/agent_dispatcher_cli.ts') for arg in (pid / 'cmdline').read_bytes().split(b'\0')):
                    return True
            except OSError:
                pass
    return False


def refresh_mcp_sessions():
    for pid in Path('/proc').iterdir():
        if pid.name.isdigit():
            try:
                if b'/opt/bots/src/hydra-sync/mcp_server.ts' in (pid / 'cmdline').read_bytes().split(b'\0'):
                    os.kill(int(pid.name), 15)
            except (OSError, ProcessLookupError):
                pass


def rollback_healthy(state, reason):
    try:
        with lock_file(CRAWLER_LOCK):
            if bot_busy():
                state['rollbackDeferred'] = 'Waiting for active bot turn'
                write_json(BASE / 'status.json', state)
                return state
            state.pop('rollbackDeferred', None)
            return rollback_healthy_locked(state, reason)
    except BlockingIOError:
        state['rollbackDeferred'] = 'Waiting for active crawler'
        write_json(BASE / 'status.json', state)
        return state


def rollback_healthy_locked(state, reason):
    sha = fallback_sha(state)
    if not sha:
        state.update(recoveryBlocked=True, phase='incident', incident='No certified healthy fallback available')
        write_json(BASE / 'status.json', state)
        return state
    target = BASE / 'releases' / validate_sha(sha)
    manifest = BASE / 'manifests' / (sha + '.json')
    if not target.is_dir() or target.is_symlink() or not manifest.exists() or find_drift(target, json.loads(manifest.read_text())):
        state.update(recoveryBlocked=True, phase='incident', incident='Healthy fallback missing or modified; intervention required')
        write_json(BASE / 'status.json', state)
        return state
    bad = state['current']
    reject_release(state, bad, reason)
    # The selected fallback is preserved, but no longer called healthy without rechecking.
    state.update(current=sha, previous=bad, lastHealthy=sha, rollbackAttempted=True,
                 healthyHistory=[s for s in state.get('healthyHistory', []) if s != bad],
                 deployedAt=datetime.now(timezone.utc).isoformat())
    for key in ['healthySince', 'lastHealth', 'lastUptime', 'lastRestarts']:
        state.pop(key, None)
    write_json(BASE / 'pending.json', {'mode': 'healthy-rollback', 'target': sha, 'state': state, 'reason': reason})
    return finish_healthy_rollback(state, target, reason)


def monitor_active(state):
    if not state.get('current') or state.get('recoveryBlocked'):
        return state
    current = BASE / 'current'
    if not current.is_symlink() or current.resolve() != BASE / 'releases' / validate_sha(state['current']):
        raise RuntimeError('Active release pointer changed manually')
    action = observe_health(state, probe_health(), time.time())
    if action != 'promote':
        write_json(BASE / 'status.json', state)
    if action == 'rollback':
        return rollback_healthy(state, state['lastHealth']['reason'])
    if action == 'incident':
        state.update(recoveryBlocked=True, phase='incident', incident='Fallback failed after recovery; version hopping stopped' if state.get('rollbackAttempted') else 'No certified healthy fallback available')
        write_json(BASE / 'status.json', state)
    elif action == 'promote':
        manifest = BASE / 'manifests' / (state['current'] + '.json')
        if not manifest.exists() or find_drift(current.resolve(), json.loads(manifest.read_text())):
            raise RuntimeError('Manual changes block certification of the release')
        # Candidate controllers replace the stable controller only after observation.
        candidate_controller = current / 'deploy' / 'sync.py'
        if b'def monitor_active(' in candidate_controller.read_bytes():
            install_controller(current)
        prune_retired(state)
        write_json(BASE / 'status.json', state)
        print('Certified healthy: ' + state['current'])
    return state


def restart_bot():
    env = dict(os.environ, DOTENV_CONFIG_PATH=str(BASE / 'shared' / '.env'))
    run(['/usr/bin/pm2', 'restart', 'hydra-bot', '--update-env'], env=env, timeout=60)


def prepare_release(sha, git_env):
    release = BASE / 'releases' / sha
    record = BASE / 'manifests' / (sha + '.json')
    if record.exists():
        if find_drift(release, json.loads(record.read_text())):
            raise RuntimeError('Prepared release has manual changes')
        return release
    # Never reuse a partially prepared directory; preserve it for diagnosis.
    if release.exists():
        release.rename(release.with_name(sha + '.incomplete.' + str(int(time.time()))))
    release.mkdir(parents=True)
    archive = subprocess.run(['git', '--git-dir=' + str(BASE / 'repo.git'), 'archive', sha], env=git_env, check=True, stdout=subprocess.PIPE).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if member.issym() or member.islnk() or member.name.startswith('/') or '..' in Path(member.name).parts:
                raise RuntimeError('Unsafe release archive')
        tar.extractall(release, filter='data')
    run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=release)
    run(['npm', 'run', 'verify'], cwd=release)
    run(['python3', '-m', 'unittest', 'discover', '-s', 'deploy/tests', '-v'], cwd=release)
    if not functional_ready(release):
        raise RuntimeError('Candidate functional probe failed')
    # Native DB drivers are checked in memory, without opening the production database.
    run(['node', '--input-type=module', '-e', "import {createRequire} from 'module';const r=createRequire(process.cwd()+'/package.json');const D=r('better-sqlite3');const db=new D(':memory:');r('sqlite-vec').load(db);db.close();"], cwd=release)
    (release / '.env').symlink_to(BASE / 'shared' / '.env')
    for name in ['.auth', 'state', 'downloads']:
        persistent = Path('/opt/bots') / name
        if persistent.is_dir():
            (release / name).symlink_to(persistent, target_is_directory=True)
    write_json(record, fingerprint(release))
    return release


def check_compatibility_links(config):
    for item in config['links']:
        link = Path(item['path'])
        target = BASE / 'current' / item['relative']
        if not link.is_symlink() or os.readlink(link) != str(target):
            raise RuntimeError('Production path changed manually: ' + str(link))


def recover_pending():
    if not (BASE / 'pending.json').exists():
        return
    with lock_file(CRAWLER_LOCK):
        if bot_busy():
            raise BlockingIOError('Recovery is waiting for active bot turn')
        recover_pending_locked()


def recover_pending_locked():
    journal = BASE / 'pending.json'
    if not journal.exists():
        return
    pending = json.loads(journal.read_text())
    target = BASE / 'releases' / validate_sha(pending['target'])
    if pending.get('mode') == 'healthy-rollback':
        finish_healthy_rollback(pending['state'], target, pending['reason'])
        return
    status_file = BASE / 'status.json'
    status = json.loads(status_file.read_text()) if status_file.exists() else {}
    current = BASE / 'current'
    if status.get('current') == pending['target'] and current.resolve() == target:
        refresh_mcp_sessions()
        journal.unlink()
        return
    previous = Path(pending['previousPath'])
    if previous.parent != BASE / 'releases' or not previous.is_dir():
        raise RuntimeError('Invalid recovery path')
    atomic_link(current, previous)
    recovered = False
    try:
        restart_bot()
        recovered = health_check()
    except Exception:
        pass
    state = pending['before']
    if not recovered:
        reject_release(state, pending['target'], 'Interrupted deployment recovery health check failed')
        state.update(recoveryBlocked=True, rollbackAttempted=True, phase='incident', incident='Interrupted recovery failed; version hopping stopped')
    write_json(status_file, state)
    refresh_mcp_sessions()
    journal.unlink()
    print('Recovered the release preceding an interrupted deployment')


def verify_release(sha, git_env):
    sha = validate_sha(sha)
    tag = 'refs/tags/hydra-release/' + sha
    prefix = ['git', '--git-dir=' + str(BASE / 'repo.git')]
    target = run(prefix + ['rev-parse', tag + '^{commit}'], env=git_env)
    if target != sha:
        raise RuntimeError('Release signature targets a different commit')
    run(prefix + ['-c', 'gpg.format=ssh', '-c', 'gpg.ssh.allowedSignersFile=' + str(BASE / 'allowed_signers'), 'verify-tag', tag], env=git_env)


def deploy(rollback=False):
    config = json.loads((BASE / 'config.json').read_text())
    recover_pending()
    state_path = BASE / 'status.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if (BASE / 'PAUSED').exists() and not rollback:
        print('Sync paused; remove PAUSED to resume')
        return
    if not rollback:
        state = monitor_active(state)
    git_env = dict(os.environ, GIT_SSH_COMMAND='ssh -i ' + str(BASE / 'github-readonly') + ' -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=' + str(BASE / 'known_hosts'))
    if rollback:
        sha = validate_sha(fallback_sha(state) or state.get('previous', ''))
        if sha in state.get('rejected', []):
            raise RuntimeError('Manual rollback target is a rejected commit')
        (BASE / 'PAUSED').touch()
    else:
        run(['git', '--git-dir=' + str(BASE / 'repo.git'), 'fetch', '--prune', 'origin'], env=git_env, timeout=25)
        sha = validate_sha(run(['git', '--git-dir=' + str(BASE / 'repo.git'), 'rev-parse', 'refs/heads/production'], env=git_env))
        main = run(['git', '--git-dir=' + str(BASE / 'repo.git'), 'rev-parse', 'refs/heads/main'], env=git_env)
        if sha != main:
            print('Waiting for CI to validate the latest main commit')
            return
    verify_release(sha, git_env)
    current = BASE / 'current'
    if state.get('current'):
        active = validate_sha(state['current'])
        expected = json.loads((BASE / 'manifests' / (active + '.json')).read_text())
        if not current.is_symlink() or current.resolve() != BASE / 'releases' / active:
            raise RuntimeError('Active release pointer changed manually')
        drift = find_drift(current.resolve(), expected)
        if drift:
            raise RuntimeError('Manual changes block deploy: ' + ', '.join(drift[:5]))
        check_compatibility_links(config)
    if state.get('current') == sha:
        print('Already synchronized: ' + sha)
        return
    if not rollback and state.get('failed') == sha:
        print('Release previously failed; inspect status.json before retry')
        return
    if not rollback and sha in state.get('rejected', []):
        print('Rejected commit; waiting for a new push')
        return
    if not rollback and not state.get('lastHealthy') and not state.get('recoveryBlocked'):
        print('Observing the initial baseline before accepting another release')
        return
    if not rollback and state.get('phase') == 'observing' and not state.get('recoveryBlocked'):
        print('Current release is still in its ten-minute observation period')
        return
    try:
        target = prepare_release(sha, git_env)
    except Exception as error:
        reject_release(state, sha, 'Preparation: ' + str(error))
        write_json(state_path, state)
        raise
    try:
        with lock_file(CRAWLER_LOCK):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3333/health', timeout=3) as response:
                    listener = json.load(response).get('listener', {})
            except OSError:
                if not state.get('recoveryBlocked'):
                    raise
                listener = {'queueSize': 0, 'activeChats': 0, 'isProcessing': False}
            if listener.get('queueSize', 1) or listener.get('activeChats', 1) or listener.get('isProcessing', True):
                print('Bot is processing messages; deploy deferred')
                return
            # Child dispatcher processes may be serving a current turn. Defer instead of terminating them.
            for pid in Path('/proc').iterdir():
                if not pid.name.isdigit():
                    continue
                try:
                    args = (pid / 'cmdline').read_bytes().split(b'\0')
                    if any(arg.endswith(b'/agent_dispatcher_cli.ts') for arg in args):
                        print('Active bot turn; deploy deferred')
                        return
                except OSError:
                    pass
            previous = current.resolve()
            new_state = {**state, 'current': sha, 'previous': previous.name if re.fullmatch(r'[0-9a-f]{40}', previous.name) else None, 'deployedAt': datetime.now(timezone.utc).isoformat(), 'repository': config['repository'], 'phase': 'observing', 'healthFailures': 0, 'recoveryBlocked': False, 'rollbackAttempted': False, 'incident': None}
            for key in ['healthySince', 'lastHealth', 'lastUptime', 'lastRestarts', 'rollbackDeferred']:
                new_state.pop(key, None)
            write_json(BASE / 'pending.json', {'before': state, 'previousPath': str(previous), 'target': sha})
            activate(current, target, restart_bot, health_check, lambda: write_json(state_path, new_state))
            # Existing idle AGY MCP sessions must reconnect using the active source tree.
            refresh_mcp_sessions()
            (BASE / 'pending.json').unlink()
    except BlockingIOError:
        print('Crawler is running; deploy deferred')
        return
    except Exception as error:
        reject_release(state, sha, str(error))
        journal = BASE / 'pending.json'
        if journal.exists():
            pending = json.loads(journal.read_text())
            pending['before'] = state
            write_json(journal, pending)
            if current.resolve() == Path(pending['previousPath']):
                state['rollbackAttempted'] = True
                for key in ['healthySince', 'lastHealth', 'lastUptime', 'lastRestarts']:
                    state.pop(key, None)
                if not health_check():
                    state.update(recoveryBlocked=True, phase='incident', incident='Initial rollback also failed; automatic version hopping stopped')
                journal.unlink()
        write_json(state_path, state)
        raise
    print('Deployed for observation: ' + sha)


if __name__ == '__main__':
    if '--probe-functional' in sys.argv:
        sys.exit(subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', FUNCTIONAL_PROBE], timeout=25).returncode)
    BASE.mkdir(parents=True, exist_ok=True)
    try:
        with lock_file(BASE / 'deploy.lock'):
            deploy(rollback='--rollback' in sys.argv)
    except BlockingIOError:
        print('Another deployment is running')
    except Exception as error:
        print('Deploy failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
