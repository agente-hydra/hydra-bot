import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
import subprocess

MODULE = Path(__file__).resolve().parents[1] / 'sync.py'


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.is_file(), 'Deploy controller is not implemented')
        spec = importlib.util.spec_from_file_location('hydra_sync', MODULE)
        self.sync = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.sync)
        for name in ['bot_busy', 'refresh_mcp_sessions']:
            guard = patch.object(self.sync, name, return_value=False, create=True)
            guard.start()
            self.addCleanup(guard.stop)

    def test_rejects_non_commit_identifiers(self):
        for value in ['main', '../other', 'a' * 39, 'g' * 40]:
            with self.assertRaises(ValueError):
                self.sync.validate_sha(value)
        self.assertEqual(self.sync.validate_sha('a' * 40), 'a' * 40)

    def test_detects_changed_and_missing_production_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'code.ts').write_text('original')
            expected = self.sync.fingerprint(root)
            self.assertEqual(self.sync.find_drift(root, expected), [])
            (root / 'code.ts').write_text('manual change')
            self.assertEqual(self.sync.find_drift(root, expected), ['code.ts'])
            (root / 'code.ts').unlink()
            self.assertEqual(self.sync.find_drift(root, expected), ['code.ts'])

    def test_ignores_runtime_credentials_and_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / '.env').write_text('SECRET=private')
            (root / 'node_modules').mkdir()
            (root / 'node_modules' / 'code.js').write_text('dependency')
            (root / 'code.ts').write_text('managed')
            self.assertEqual(list(self.sync.fingerprint(root)), ['code.ts'])

    def test_atomic_activation_restores_previous_after_failed_health(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / 'old'; old.mkdir()
            new = root / 'new'; new.mkdir()
            current = root / 'current'
            current.symlink_to(old, target_is_directory=True)
            restarts = []
            with self.assertRaises(RuntimeError):
                self.sync.activate(current, new, lambda: restarts.append(current.resolve().name), lambda: False)
            self.assertEqual(current.resolve(), old)
            self.assertEqual(restarts, ['new', 'old'])

    def test_successful_activation_checks_health_before_finishing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / 'old'; old.mkdir()
            new = root / 'new'; new.mkdir()
            current = root / 'current'; current.symlink_to(old, target_is_directory=True)
            checks = []
            previous = self.sync.activate(current, new, lambda: checks.append('restart'), lambda: checks.append('health') or True)
            self.assertEqual(previous, old)
            self.assertEqual(current.resolve(), new)
            self.assertEqual(checks, ['restart', 'health'])

    def test_status_write_failure_rolls_back_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / 'old'; old.mkdir()
            new = root / 'new'; new.mkdir()
            current = root / 'current'; current.symlink_to(old, target_is_directory=True)
            def broken_commit():
                raise OSError('disk full')
            with self.assertRaises(OSError):
                self.sync.activate(current, new, lambda: None, lambda: True, broken_commit)
            self.assertEqual(current.resolve(), old)

    def test_health_requires_actual_online_listener(self):
        self.assertFalse(self.sync.listener_ready({}))
        self.assertFalse(self.sync.listener_ready({'listener': {'status': 'offline'}}))
        self.assertTrue(self.sync.listener_ready({'listener': {'status': 'online'}}))

    def test_interrupted_activation_recovers_pointer_and_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            self.sync.BASE = base
            old_sha = 'a' * 40; new_sha = 'b' * 40
            old = base / 'releases' / old_sha; old.mkdir(parents=True)
            new = base / 'releases' / new_sha; new.mkdir()
            (base / 'current').symlink_to(new, target_is_directory=True)
            before = {'current': old_sha, 'failed': new_sha}
            (base / 'status.json').write_text(json.dumps({'current': old_sha}))
            (base / 'pending.json').write_text(json.dumps({'target': new_sha, 'previousPath': str(old), 'before': before}))
            with patch.object(self.sync, 'restart_bot'), patch.object(self.sync, 'health_check', return_value=True):
                self.sync.recover_pending()
            self.assertEqual((base / 'current').resolve(), old)
            self.assertEqual(json.loads((base / 'status.json').read_text()), before)
            self.assertFalse((base / 'pending.json').exists())

    @unittest.skipUnless(os.name == 'posix', 'Production Git/SSH signing on Linux')
    def test_requires_a_release_tag_signed_by_the_trusted_ci_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            repo = base / 'work'; repo.mkdir()
            def cmd(*args):
                return subprocess.run(args, cwd=repo, text=True, capture_output=True, check=True).stdout.strip()
            cmd('git', 'init', '-q')
            cmd('git', 'config', 'user.name', 'Hydra test')
            cmd('git', 'config', 'user.email', 'hydra-test@example.invalid')
            (repo / 'code.ts').write_text('baseline')
            cmd('git', 'add', 'code.ts'); cmd('git', 'commit', '-qm', 'baseline')
            sha = cmd('git', 'rev-parse', 'HEAD')
            tag = 'hydra-release/' + sha
            key = base / 'ci-key'
            cmd('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key))
            (base / 'allowed_signers').write_text('hydra-ci ' + key.with_suffix('.pub').read_text())
            cmd('git', 'config', 'gpg.format', 'ssh')
            cmd('git', 'config', 'user.signingkey', str(key))
            cmd('git', 'tag', '-a', '-m', 'unsigned', tag)
            cmd('git', 'clone', '--mirror', '-q', str(repo), str(base / 'repo.git'))
            with self.assertRaises(RuntimeError):
                self.sync.verify_release(sha, os.environ)
            cmd('git', 'tag', '-d', tag)
            cmd('git', 'tag', '-s', '-m', 'validated', tag)
            cmd('git', '--git-dir=' + str(base / 'repo.git'), 'fetch', '--force', 'origin', 'refs/tags/' + tag + ':refs/tags/' + tag)
            self.sync.verify_release(sha, os.environ)

    @unittest.skipUnless(os.name == 'posix', 'Linux file locks')
    def test_crawler_lock_defers_deploy_without_interrupting_holder(self):
        import fcntl
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'crawler.lock'
            with path.open('w') as holder:
                fcntl.flock(holder, fcntl.LOCK_EX)
                with self.assertRaises(BlockingIOError):
                    with self.sync.lock_file(path):
                        self.fail('deployment acquired a busy crawler lock')


if __name__ == '__main__':
    unittest.main()
