import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
import subprocess
import builtins
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ddns', Path(__file__).with_name('onecloud-ddns.py'))
ddns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ddns)

class AddressSafety(unittest.TestCase):
    def test_probe_falls_back_after_timeout_and_checks_exact_ipv6_source(self):
        outcomes = [subprocess.TimeoutExpired('curl', 15), SimpleNamespace(returncode=0, stdout='ip=2409::1\n')]
        with patch.object(ddns.subprocess, 'run', side_effect=outcomes) as run:
            self.assertTrue(ddns.probe('2409::1'))
            self.assertEqual(run.call_count, 2)
            for call in run.call_args_list:
                command = call.args[0]
                self.assertIn('-6', command)
                self.assertIn('--noproxy', command)
                self.assertEqual(command[command.index('--interface') + 1], '2409::1')

    def test_probe_rejects_wrong_ipv6_ipv4_and_invalid_response(self):
        responses = [SimpleNamespace(returncode=0, stdout='2409::2'),
                     SimpleNamespace(returncode=0, stdout='ip=117.1.2.3\n'),
                     SimpleNamespace(returncode=0, stdout='not an address')]
        with patch.object(ddns.subprocess, 'run', side_effect=responses):
            self.assertFalse(ddns.probe('2409::1'))

    def test_probe_failure_and_address_ambiguity_have_distinct_errors(self):
        with self.assertRaisesRegex(RuntimeError, '^ipv6_probe_failed$'):
            ddns.select_verified(['2409::1'], [], [], 'eth0')
        with self.assertRaisesRegex(RuntimeError, '^ambiguous_verified_ipv6$'):
            ddns.select_verified(['2409::1','2409::2'], ['2409::1','2409::2'], [], 'eth0')

    def test_rejects_unusable_addresses(self):
        infos = []
        for index, flag in enumerate(['temporary', 'tentative', 'deprecated', 'dadfailed'], 1):
            infos.append({'family': 'inet6', 'scope': 'global', 'local': f'2409::a:{index}', flag: True})
        infos += [
            {'family': 'inet6', 'scope': 'global', 'local': 'fd01::1'},
            {'family': 'inet6', 'scope': 'global', 'local': '2409::2', 'preferred_life_time': 0},
            {'family': 'inet6', 'scope': 'global', 'local': '2409::3', 'valid_life_time': 0},
            {'family': 'inet6', 'scope': 'global', 'local': '2409::4', 'flags': ['temporary']},
            {'family': 'inet6', 'scope': 'global', 'local': '2409::5', 'preferred_life_time': 120},
        ]
        self.assertEqual(ddns.candidates([{'ifname':'eth0','flags':['UP'],'addr_info':infos}], 'eth0'), ['2409::5'])

    def test_down_interface_is_not_selected(self):
        self.assertEqual(ddns.candidates([{'ifname':'eth0','flags':[],'addr_info':[
            {'family':'inet6','scope':'global','local':'2409::1'}]}], 'eth0'), [])

    def test_unverified_old_prefix_is_not_selected(self):
        with self.assertRaises(RuntimeError):
            ddns.select_verified(['2409::1'], [], [{'dev':'eth0','prefsrc':'2409::1'}], 'eth0')

    def test_multiple_verified_addresses_use_route_source(self):
        self.assertEqual(ddns.select_verified(['2409::1','2409::2'], ['2409::1','2409::2'],
            [{'dev':'eth0','prefsrc':'2409::2'}], 'eth0'), '2409::2')

    def test_ambiguous_addresses_are_rejected(self):
        with self.assertRaises(RuntimeError):
            ddns.select_verified(['2409::1','2409::2'], ['2409::1','2409::2'], [], 'eth0')

    def test_ipv4_or_proxy_does_not_pass_ipv6_confirmation(self):
        desired={'name':'ip.example.org','content':'2409::1','ttl':120}
        for record in [
            {'name':'ip.example.org','content':'117.1.2.3','ttl':120,'type':'A','proxied':False},
            {'name':'ip.example.org','content':'2409::1','ttl':120,'type':'AAAA','proxied':True},
        ]:
            self.assertFalse(ddns.matches(record, desired))

    def test_atomic_status_never_persists_credentials(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(ddns, 'STATUS', Path(directory)/'status.json'):
            ddns.persist_status({'status':'unchanged','name':'ip.example.org','ipv6':'2409::1',
                'lastSuccessAt':'2026-10-05T12:00:00Z','api_key':'SECRET','email':'private@example.org'})
            saved = ddns.STATUS.read_text()
            self.assertNotIn('SECRET', saved)
            self.assertNotIn('private', saved)
            self.assertEqual(ddns.STATUS.stat().st_mode & 0o777, 0o600)
            self.assertEqual(ddns.previous_status()['ipv6'], '2409::1')

    def test_failed_status_preserves_last_success_without_claiming_success(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(ddns, 'STATUS', Path(directory)/'status.json'):
            ddns.persist_status({'name':'ip.example.org','status':'unchanged','ipv6':'2409::1',
                'lastSuccessAt':'2026-10-05T12:00:00Z'})
            ddns.persist_status({**ddns.previous_status(),'status':'error','errorCode':'dns_check_mismatch',
                'lastAttemptAt':'2026-10-05T12:02:00Z'})
            saved = json.loads(ddns.STATUS.read_text())
            self.assertEqual(saved['status'],'error')
            self.assertEqual(saved['lastSuccessAt'],'2026-10-05T12:00:00Z')
            self.assertEqual(ddns.safe_error(RuntimeError('Authorization: secret-token')), 'ddns_operation_failed')

    def test_success_cache_is_scoped_to_name_zone_and_record(self):
        config = {'name': 'ip.example.org', 'zone_id': 'zone-1', 'record_id': 'record-1'}
        with tempfile.TemporaryDirectory() as directory, patch.object(ddns, 'STATUS', Path(directory)/'status.json'):
            ddns.persist_status({'name': config['name'], 'ipv6': '2409::1', 'proxied': False,
                'lastSuccessAt': '2026-10-05T12:00:00Z', 'recordIdentity': ddns.record_identity(config)})
            self.assertEqual(ddns.previous_status(config)['ipv6'], '2409::1')
            for change in [{'name': 'new.example.org'}, {'zone_id': 'zone-2'}, {'record_id': 'record-2'}]:
                self.assertEqual(ddns.previous_status({**config, **change}), {})
            # Old observations have no provider identity and cannot prove ownership.
            ddns.persist_status({'name': config['name'], 'ipv6': '2409::1', 'lastSuccessAt': '2026-10-05T12:00:00Z'})
            self.assertEqual(ddns.previous_status(config), {})

    def test_main_failure_never_relabels_previous_record_success(self):
        old = {'name': 'old.example.org', 'zone_id': 'zone-1', 'record_id': 'record-1'}
        new = {**old, 'name': 'new.example.org', 'interface': 'eth0'}
        original_open = builtins.open
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            config = folder/'config.json'
            config.write_text(json.dumps(new)); config.chmod(0o600)
            def opened(path, *args, **kwargs):
                return original_open(folder/'lock' if str(path) == '/run/onecloud-ddns.lock' else path, *args, **kwargs)
            with patch.object(ddns, 'CONFIG', config), patch.object(ddns, 'STATUS', folder/'status.json'), patch.object(ddns, 'run_json', return_value=[]), patch('builtins.open', side_effect=opened), patch.object(ddns.sys, 'argv', ['writer']):
                ddns.persist_status({'name': old['name'], 'ipv6': '2409::1', 'proxied': False,
                    'lastSuccessAt': '2026-10-05T12:00:00Z', 'recordIdentity': ddns.record_identity(old)})
                with self.assertRaisesRegex(RuntimeError, 'invalid_ipv6_candidate_count'):
                    ddns.main()
                saved = json.loads(ddns.STATUS.read_text())
                self.assertEqual(saved['name'], new['name'])
                self.assertEqual(saved['status'], 'error')
                self.assertNotIn('lastSuccessAt', saved)
                self.assertNotIn('ipv6', saved)
                self.assertEqual(saved['recordIdentity'], ddns.record_identity(new))

    def test_updates_only_configured_aaaa_and_preserves_coexisting_a(self):
        config = {'name': 'ip.example.org', 'record_id': 'aaaa', 'ttl': 120}
        records = {'a': {'id': 'a', 'name': config['name'], 'type': 'A', 'content': '198.51.100.1', 'ttl': 120, 'proxied': False},
                   'aaaa': {'id': 'aaaa', 'name': config['name'], 'type': 'AAAA', 'content': '2409::1', 'ttl': 120, 'proxied': False}}
        original_a = dict(records['a'])
        writes = []
        def api(_config, path, method='GET', payload=None):
            if '?' in path:
                self.assertEqual(ddns.urllib.parse.parse_qs(path.split('?', 1)[1])['type'], ['AAAA'])
                return {'result': [dict(record) for record in records.values() if record['type'] == 'AAAA']}
            identifier = path.rsplit('/', 1)[1]
            if method == 'PUT':
                writes.append(identifier)
                records[identifier] = {'id': identifier, **payload}
            return {'result': dict(records[identifier])}
        with patch.object(ddns, 'api', side_effect=api):
            self.assertTrue(ddns.update(config, '2409::2'))
            self.assertFalse(ddns.update(config, '2409::2'))
        self.assertEqual(records['a'], original_a)
        self.assertEqual(writes, ['aaaa'])

    def test_rejects_other_aaaa_records_and_wrong_target_identity(self):
        config = {'name': 'ip.example.org', 'record_id': 'target', 'ttl': 120}
        record = {'id': 'target', 'name': config['name'], 'type': 'AAAA'}
        with patch.object(ddns, 'api', side_effect=[{'result': record}, {'result': [record, {**record, 'id': 'other'}]}]) as api:
            with self.assertRaisesRegex(RuntimeError, 'ambiguous_dns_records'):
                ddns.update(config, '2409::1')
            self.assertTrue(all(len(call.args) < 3 or call.args[2] != 'PUT' for call in api.call_args_list))
        with patch.object(ddns, 'api', return_value={'result': {**record, 'id': 'wrong'}}):
            with self.assertRaisesRegex(RuntimeError, 'dns_record_identity_mismatch'):
                ddns.update(config, '2409::1')

    def test_converts_the_configured_a_when_no_aaaa_exists(self):
        config = {'name': 'ip.example.org', 'record_id': 'target', 'ttl': 120}
        old = {'id': 'target', 'name': config['name'], 'type': 'A'}
        new = {'id': 'target', 'name': config['name'], 'type': 'AAAA', 'content': '2409::1', 'ttl': 120, 'proxied': False}
        with patch.object(ddns, 'api', side_effect=[{'result': old}, {'result': []}, {'result': new}, {'result': new}]) as api:
            self.assertTrue(ddns.update(config, '2409::1'))
            self.assertEqual(api.call_args_list[2].args[2], 'PUT')

if __name__ == '__main__':
    unittest.main()
