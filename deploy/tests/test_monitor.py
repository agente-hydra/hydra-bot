import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class MonitorTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('sync_monitor', Path(__file__).parents[1] / 'sync.py')
        self.sync = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.sync)
        for name in ['bot_busy', 'refresh_mcp_sessions']:
            guard = patch.object(self.sync, name, return_value=False, create=True)
            guard.start()
            self.addCleanup(guard.stop)
        self.old = 'a' * 40
        self.new = 'b' * 40
        self.state = {'current': self.new, 'deployedAt': '1970-01-01T00:00:00+00:00',
                      'lastHealthy': self.old, 'healthyHistory': [self.old]}

    def observe(self, ok=True, now=100, reason='ready', uptime=1000):
        self.assertTrue(hasattr(self.sync, 'observe_health'), 'Continuous health policy is missing')
        return self.sync.observe_health(self.state, {'ok': ok, 'reason': reason, 'uptime': uptime}, now)

    def test_promotes_only_after_ten_minutes_of_regular_successful_checks(self):
        for now in range(100, 700, 60):
            self.assertEqual(self.observe(now=now), 'observe')
        self.assertEqual(self.observe(now=700), 'promote')
        self.assertEqual(self.state['lastHealthy'], self.new)

    def test_three_failures_trigger_rollback_and_success_resets_counter(self):
        self.assertEqual(self.observe(False, 100), 'observe')
        self.assertEqual(self.observe(False, 160), 'observe')
        self.observe(True, 220)
        self.assertEqual(self.state['healthFailures'], 0)
        for now in [280, 340]:
            self.assertEqual(self.observe(False, now), 'observe')
        self.assertEqual(self.observe(False, 400), 'rollback')

    def test_startup_grace_does_not_count_failures(self):
        self.observe(False, 30)
        self.observe(False, 60)
        self.assertEqual(self.state['healthFailures'], 0)

    def test_monitor_gap_and_process_restart_restart_stability_window(self):
        self.observe(now=100)
        self.observe(now=160)
        self.observe(now=800)
        self.assertEqual(self.state['healthySince'], 800)
        self.observe(now=860, uptime=5)
        self.assertEqual(self.state['healthySince'], 860)

    def test_stable_history_is_unique_and_limited_to_five(self):
        history = [str(i) * 40 for i in range(1, 6)]
        self.state['healthyHistory'] = history
        for now in range(100, 701, 60):
            self.observe(now=now)
        self.assertEqual(self.state['healthyHistory'], [self.new] + history[:4])
        self.assertEqual(self.state['retiredHealthy'], [history[-1]])

    def test_rollback_does_not_choose_the_failing_current_version(self):
        self.state['lastHealthy'] = self.new
        self.state['healthyHistory'] = [self.new, self.old]
        self.assertTrue(hasattr(self.sync, 'fallback_sha'), 'Healthy fallback selection is missing')
        self.assertEqual(self.sync.fallback_sha(self.state), self.old)

    def test_without_a_healthy_fallback_records_incident(self):
        self.state.pop('lastHealthy')
        self.state['healthyHistory'] = []
        for now in [100, 160]:
            self.observe(False, now)
        self.assertEqual(self.observe(False, 220), 'incident')

    def test_delayed_failure_of_fallback_does_not_roll_back_again(self):
        self.state['rollbackAttempted'] = True
        for now in [100, 160]:
            self.observe(False, now)
        self.assertEqual(self.observe(False, 220), 'incident')

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux production symlinks')
    def test_modified_release_is_not_certified_when_observation_finishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            release = base / 'releases' / self.new; release.mkdir(parents=True)
            (release / 'code.js').write_text('changed')
            (base / 'manifests').mkdir()
            (base / 'manifests' / (self.new + '.json')).write_text('{}')
            (base / 'current').symlink_to(release, target_is_directory=True)
            self.state['healthySince'] = 100
            self.state['lastHealth'] = {'at': 640}
            (base / 'status.json').write_text(json.dumps(self.state))
            with patch.object(self.sync, 'probe_health', return_value={'ok': True, 'reason': 'ready', 'uptime': 1000}), \
                    patch.object(self.sync.time, 'time', return_value=700):
                with self.assertRaises(RuntimeError):
                    self.sync.monitor_active(self.state)
            persisted = json.loads((base / 'status.json').read_text())
            self.assertEqual(persisted['lastHealthy'], self.old)
            self.assertNotEqual(persisted.get('phase'), 'stable')

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux production symlinks')
    def test_interrupted_recovery_failure_records_incident_and_clears_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            old = base / 'releases' / self.old; old.mkdir(parents=True)
            new = base / 'releases' / self.new; new.mkdir()
            (base / 'current').symlink_to(new, target_is_directory=True)
            before = {'current': self.old, 'lastHealthy': self.old}
            (base / 'status.json').write_text(json.dumps(before))
            (base / 'pending.json').write_text(json.dumps({'target': self.new, 'previousPath': str(old), 'before': before}))
            with patch.object(self.sync, 'restart_bot'), patch.object(self.sync, 'health_check', return_value=False):
                self.sync.recover_pending()
            self.assertFalse((base / 'pending.json').exists())
            self.assertTrue(json.loads((base / 'status.json').read_text())['recoveryBlocked'])

    def test_rejected_commit_stays_rejected_after_another_failed_push(self):
        self.assertTrue(hasattr(self.sync, 'reject_release'), 'Persistent rejected commits are missing')
        self.sync.reject_release(self.state, self.new, 'failed')
        self.sync.reject_release(self.state, 'c' * 40, 'failed')
        self.assertIn(self.new, self.state['rejected'])
        self.assertNotIn('d' * 40, self.state['rejected'])

    def test_monitor_runs_before_github_fetch_even_when_it_is_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            (base / 'config.json').write_text(json.dumps({'repository': 'test', 'links': []}))
            (base / 'status.json').write_text(json.dumps(self.state))
            events = []
            self.assertTrue(hasattr(self.sync, 'monitor_active'), 'Offline monitoring is missing')
            with patch.object(self.sync, 'recover_pending'), patch.object(self.sync, 'monitor_active',
                    side_effect=lambda state: events.append('monitor') or state), patch.object(self.sync, 'run',
                    side_effect=lambda *a, **k: events.append('fetch') or (_ for _ in ()).throw(OSError('offline'))):
                with self.assertRaises(OSError):
                    self.sync.deploy()
            self.assertEqual(events[:2], ['monitor', 'fetch'])

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux production symlinks')
    def test_committed_pending_deploy_refreshes_mcp_before_removing_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            target = base / 'releases' / self.new; target.mkdir(parents=True)
            (base / 'current').symlink_to(target, target_is_directory=True)
            (base / 'status.json').write_text(json.dumps({'current': self.new}))
            (base / 'pending.json').write_text(json.dumps({'target': self.new}))
            self.sync.recover_pending()
            self.sync.refresh_mcp_sessions.assert_called_once()
            self.assertFalse((base / 'pending.json').exists())

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux production symlinks')
    def test_crawler_lock_defers_automatic_rollback(self):
        import fcntl
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            self.sync.CRAWLER_LOCK = base / 'crawler.lock'
            for sha in [self.old, self.new]:
                (base / 'releases' / sha).mkdir(parents=True)
            (base / 'manifests').mkdir()
            (base / 'manifests' / (self.old + '.json')).write_text('{}')
            (base / 'current').symlink_to(base / 'releases' / self.new, target_is_directory=True)
            with self.sync.CRAWLER_LOCK.open('w') as holder:
                fcntl.flock(holder, fcntl.LOCK_EX)
                result = self.sync.rollback_healthy(self.state, 'failed')
            self.assertEqual((base / 'current').resolve().name, self.new)
            self.assertNotIn(self.new, result.get('rejected', []))

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux production symlinks')
    def test_pruning_old_code_preserves_linked_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            retired = '1' * 40
            root = base / 'releases' / retired; root.mkdir(parents=True)
            shared = base / 'shared'; shared.mkdir(); (shared / 'session').write_text('keep')
            (root / '.auth').symlink_to(shared, target_is_directory=True)
            (root / 'code.ts').write_text('old code')
            (base / 'manifests').mkdir()
            (base / 'manifests' / (retired + '.json')).write_text(json.dumps(self.sync.fingerprint(root)))
            self.state['retiredHealthy'] = [retired]
            self.sync.prune_retired(self.state)
            self.assertFalse(root.exists())
            self.assertEqual((shared / 'session').read_text(), 'keep')

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux production symlinks')
    def test_failed_fallback_stops_at_previous_healthy_code_without_hopping(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); self.sync.BASE = base
            for sha in [self.old, self.new]:
                (base / 'releases' / sha).mkdir(parents=True)
            (base / 'manifests').mkdir()
            (base / 'manifests' / (self.old + '.json')).write_text('{}')
            (base / 'current').symlink_to(base / 'releases' / self.new, target_is_directory=True)
            restarts = []
            self.assertTrue(hasattr(self.sync, 'rollback_healthy'), 'Verified automatic rollback is missing')
            with patch.object(self.sync, 'restart_bot', side_effect=lambda: restarts.append(1)), \
                    patch.object(self.sync, 'health_check', return_value=False):
                result = self.sync.rollback_healthy(self.state, 'local readiness failed')
            self.assertEqual((base / 'current').resolve().name, self.old)
            self.assertTrue(result['recoveryBlocked'])
            self.assertEqual(len(restarts), 1)
            self.assertIn(self.new, result['rejected'])
            self.sync.refresh_mcp_sessions.assert_called_once()


if __name__ == '__main__':
    unittest.main()
