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
import subprocess
import sys
import tarfile
import time
import urllib.request

BASE = Path(os.environ.get('HYDRA_DEPLOY_ROOT', '/home/operacional/hydra-deploy'))
IGNORED = {'.env', '.auth', 'state', 'downloads', 'node_modules', '__pycache__', '.git', '.migration', '.superpowers'}


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


def health_check():
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3333/health', timeout=3) as response:
                data = json.load(response)
            if response.status == 200 and listener_ready(data):
                return database_ready()
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False


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
    journal = BASE / 'pending.json'
    if not journal.exists():
        return
    pending = json.loads(journal.read_text())
    target = BASE / 'releases' / validate_sha(pending['target'])
    status_file = BASE / 'status.json'
    status = json.loads(status_file.read_text()) if status_file.exists() else {}
    current = BASE / 'current'
    if status.get('current') == pending['target'] and current.resolve() == target:
        journal.unlink()
        return
    previous = Path(pending['previousPath'])
    if previous.parent != BASE / 'releases' or not previous.is_dir():
        raise RuntimeError('Invalid recovery path')
    atomic_link(current, previous)
    restart_bot()
    if not health_check():
        raise RuntimeError('Interrupted deployment recovery health check failed')
    write_json(status_file, pending['before'])
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
    git_env = dict(os.environ, GIT_SSH_COMMAND='ssh -i ' + str(BASE / 'github-readonly') + ' -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=' + str(BASE / 'known_hosts'))
    if rollback:
        sha = validate_sha(state.get('previous', ''))
        (BASE / 'PAUSED').touch()
    else:
        run(['git', '--git-dir=' + str(BASE / 'repo.git'), 'fetch', '--prune', 'origin'], env=git_env)
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
    try:
        target = prepare_release(sha, git_env)
    except Exception as error:
        state.update(failed=sha, lastError='Preparation: ' + str(error))
        write_json(state_path, state)
        raise
    try:
        with lock_file('/tmp/hydra-data-refresh.lock'):
            with urllib.request.urlopen('http://127.0.0.1:3333/health', timeout=3) as response:
                listener = json.load(response).get('listener', {})
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
            old_mcp = []
            for pid in Path('/proc').iterdir():
                if pid.name.isdigit():
                    try:
                        if b'/opt/bots/src/hydra-sync/mcp_server.ts' in (pid / 'cmdline').read_bytes().split(b'\0'):
                            old_mcp.append(int(pid.name))
                    except OSError:
                        pass
            new_state = {'current': sha, 'previous': previous.name if re.fullmatch(r'[0-9a-f]{40}', previous.name) else None, 'deployedAt': datetime.now(timezone.utc).isoformat(), 'repository': config['repository']}
            write_json(BASE / 'pending.json', {'before': state, 'previousPath': str(previous), 'target': sha})
            activate(current, target, restart_bot, health_check, lambda: write_json(state_path, new_state))
            (BASE / 'pending.json').unlink()
            # Existing idle AGY MCP sessions must reconnect using the active source tree.
            for pid in old_mcp:
                try:
                    args = (Path('/proc') / str(pid) / 'cmdline').read_bytes().split(b'\0')
                    if b'/opt/bots/src/hydra-sync/mcp_server.ts' in args:
                        os.kill(pid, 15)
                except (OSError, ProcessLookupError):
                    pass
    except BlockingIOError:
        print('Crawler is running; deploy deferred')
        return
    except Exception as error:
        state.update(failed=sha, lastError=str(error))
        journal = BASE / 'pending.json'
        if journal.exists():
            pending = json.loads(journal.read_text())
            pending['before'] = state
            write_json(journal, pending)
            if current.resolve() == Path(pending['previousPath']) and health_check():
                journal.unlink()
        write_json(state_path, state)
        raise
    # The next polling cycle uses the controller that shipped with this release.
    temporary = BASE / 'sync.next.py'
    temporary.write_bytes((target / 'deploy' / 'sync.py').read_bytes())
    os.replace(temporary, BASE / 'sync.py')
    print('Deployed: ' + sha)


if __name__ == '__main__':
    BASE.mkdir(parents=True, exist_ok=True)
    try:
        with lock_file(BASE / 'deploy.lock'):
            deploy(rollback='--rollback' in sys.argv)
    except BlockingIOError:
        print('Another deployment is running')
    except Exception as error:
        print('Deploy failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
