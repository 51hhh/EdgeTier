import importlib.util
import io
from contextlib import redirect_stdout
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', Path(__file__).with_name('edgetier-host-agent.py'))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class HostSafety(unittest.TestCase):
    def test_node_config_and_internal_ring_never_leave_host(self):
        node = agent.sanitize_node({'peer_id': 57615319, 'hostname': 'home-kwrt',
            'ipv4_addr': '10.144.1.1/24', 'version': '2.6.4',
            'listeners': ['ring://private-instance', 'udp://[::]:11010'],
            'proxy_cidrs': ['192.168.1.0/24'],
            'config': 'network_secret=TOPSECRET wss://edge/ws?token=TOPSECRET'})
        encoded = json.dumps(node)
        self.assertNotIn('TOPSECRET', encoded)
        self.assertNotIn('ring', encoded)
        self.assertEqual(node['listeners'], ['udp://[::]:11010'])

    def test_actual_264_peer_metrics_and_token_removal(self):
        result = agent.sanitize_peers([{'route': {'peer_id': 10000001, 'hostname': 'edgetier-worker',
            'next_hop_peer_id': 10000001, 'proxy_cidrs': [], 'cost': 1},
            'peer': {'conns': [{'network_name': 'home-mesh', 'is_closed': False,
                'tunnel': {'tunnel_type': 'wss', 'remote_addr': {'url': 'wss://user:SECRET@edge.example:443/ws?token=SECRET'}},
                'stats': {'latency_us': 371121, 'rx_bytes': 171970, 'tx_bytes': 142476}, 'loss_rate': 0.0}]}}])
        connection = result[0]['connections'][0]
        self.assertEqual(connection['latencyMs'], 371.121)
        self.assertEqual(connection['remoteAddress'], 'wss://edge.example:443')
        self.assertNotIn('SECRET', json.dumps(result))

    def test_actual_264_protobuf_route_ipv4_preserves_virtual_address(self):
        route = {'peer_id': 57615319, 'hostname': 'home-kwrt',
                 'ipv4_addr': {'address': {'addr': 177209601}, 'network_length': 24},
                 'proxy_cidrs': ['192.168.1.0/24'], 'version': '2.6.4'}
        result = agent.sanitize_peers([{'route': route, 'peer': {'conns': []}}])
        self.assertEqual(result[0]['virtualIpv4'], '10.144.1.1/24')
        self.assertEqual(agent.address('10.144.1.1/24', version=4), '10.144.1.1/24')

    def test_protobuf_ipv6_words_decode_in_network_order(self):
        ipv6 = {'address': {'part1': 0x20010db8, 'part2': 0, 'part3': 0, 'part4': 1},
                'network_length': 64}
        self.assertEqual(agent.address(ipv6, version=6), '2001:db8::1/64')
        self.assertIsNone(agent.address(ipv6, version=4))
        node = agent.sanitize_node({'peer_id': 1, 'hostname': 'test', 'version': '2.6.4',
            'ipv6_addr': ipv6, 'listeners': [], 'proxy_cidrs': []})
        self.assertEqual(node['virtualIpv6'], '2001:db8::1/64')

    def test_malformed_protobuf_addresses_are_not_invented(self):
        invalid = [177209601, True, {'address': {'addr': True}, 'network_length': 24},
            {'address': {'addr': -1}, 'network_length': 24},
            {'address': {'addr': 2**32}, 'network_length': 24},
            {'address': {'addr': 177209601.0}, 'network_length': 24},
            {'address': {'addr': 177209601}, 'network_length': 33},
            {'address': {'addr': 177209601}, 'network_length': True},
            {'address': {'addr': 177209601}},
            {'address': {'part1': 0x20010db8, 'part4': 1}, 'network_length': 64},
            {'address': {'part1': 0x20010db8, 'part2': 0, 'part3': 0, 'part4': 1}, 'network_length': 129}]
        for value in invalid:
            with self.subTest(value=value):
                self.assertIsNone(agent.address(value))

    def test_cli_selects_stable_name_and_filters_multiinstance_envelopes(self):
        raw = [{'instance_name': 'other', 'instance_id': 'other-id', 'result': {'peer_id': 2}},
               {'instance_name': 'home-kwrt', 'instance_id': 'changed-after-restart', 'result': {'peer_id': 1}}]
        with patch.object(agent, 'run', return_value=json.dumps(raw)) as run:
            self.assertEqual(agent.cli_result(['-o', 'json', 'node', 'info'], {'instanceName': 'home-kwrt'}), {'peer_id': 1})
            run.assert_called_once_with([agent.CLI, '-p', '127.0.0.1:15888', '-n', 'home-kwrt',
                                         '-o', 'json', 'node', 'info'], timeout=20)

    def test_cli_legacy_uuid_and_direct_peer_result_are_supported(self):
        identifier = '01234567-89ab-cdef-0123-456789abcdef'
        envelopes = [{'instance_name': 'home', 'instance_id': identifier, 'result': []}]
        with patch.object(agent, 'run', return_value=json.dumps(envelopes)) as run:
            self.assertEqual(agent.cli_result(['-v', '-o', 'json', 'peer', 'list'], {'instanceId': identifier}), [])
            self.assertEqual(run.call_args.args[0][3:5], ['-i', identifier])
        pairs = [{'route': {'peer_id': 1}, 'peer': {'conns': []}}]
        with patch.object(agent, 'run', return_value=json.dumps(pairs)):
            self.assertEqual(agent.cli_result(['-v', '-o', 'json', 'peer', 'list'], {'instanceName': 'home-kwrt'}), pairs)

    def test_cli_rejects_missing_or_ambiguous_instance_envelope(self):
        for envelopes in [[{'instance_name': 'other', 'result': {}}],
                          [{'instance_name': 'home-kwrt', 'result': {}}, {'instance_name': 'home-kwrt', 'result': {}}]]:
            with self.subTest(envelopes=envelopes), patch.object(agent, 'run', return_value=json.dumps(envelopes)):
                with self.assertRaisesRegex(RuntimeError, 'instance_not_found'):
                    agent.cli_result(['-o', 'json', 'node', 'info'], {'instanceName': 'home-kwrt'})

    def test_config_requires_exactly_one_valid_explicit_instance_selector(self):
        base = {'hostId': 'onecloud', 'endpoint': 'https://edge.example', 'directHostname': 'ip.example.org'}
        invalid = [{}, {'instanceName': 'home', 'instanceId': '01234567-89ab-cdef-0123-456789abcdef'},
                   {'instanceName': ''}, {'instanceName': 'home kwrt'}, {'instanceName': '--all'},
                   {'instanceName': 'x' * 65}, {'instanceId': 'invalid'}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            for selector in invalid:
                with self.subTest(selector=selector):
                    path.write_text(json.dumps({**base, **selector}))
                    path.chmod(0o600)
                    with self.assertRaises(RuntimeError):
                        agent.validate_config(path, dry_run=True)
            path.write_text(json.dumps({**base, 'instanceName': 'home-kwrt'}))
            self.assertEqual(agent.validate_config(path, dry_run=True)['instanceName'], 'home-kwrt')

    def test_default_websocket_ports_preserve_sanitized_endpoint(self):
        self.assertEqual(agent.safe_uri('wss://user:SECRET@edge.example/ws?token=SECRET'), 'wss://edge.example:443')
        self.assertEqual(agent.safe_uri('ws://[2001:db8::1]/ws?token=SECRET'), 'ws://[2001:db8::1]:80')
        self.assertIsNone(agent.safe_uri('tcp://edge.example'))
        self.assertIsNone(agent.safe_uri('udp://edge.example:0'))

    def test_invalid_metrics_and_protocols_not_reported(self):
        self.assertIsNone(agent.number(float('nan')))
        self.assertIsNone(agent.number(True))
        self.assertIsNone(agent.number(-1))
        self.assertIsNone(agent.safe_uri('file:///etc/secrets'))
        self.assertIsNone(agent.safe_uri('tcp://host:99999'))

    def test_command_retries_execute_fixed_writer_only_once(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(agent, 'STATE', Path(directory)/'state.json'), patch.object(agent, 'run', return_value='ok') as run:
            state = {}
            command = {'id': 'request_1', 'kind': 'ddns-refresh', 'expiresAt': '2099-01-01T00:00:00Z'}
            self.assertTrue(agent.execute_command(command, state))
            self.assertFalse(agent.execute_command(command, state))
            run.assert_called_once_with(['/bin/systemctl', 'start', 'onecloud-ddns.service'], timeout=230)
            self.assertEqual(state['ack']['status'], 'completed')

    def test_command_failure_retained_and_expired_or_arbitrary_commands_rejected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(agent, 'STATE', Path(directory)/'state.json'), patch.object(agent, 'run', side_effect=RuntimeError('private details')) as run:
            state = {}
            command = {'id':'request_2','kind':'ddns-refresh','expiresAt':'2099-01-01T00:00:00Z'}
            agent.execute_command(command, state)
            self.assertEqual(state['ack']['errorCode'], 'ddns_refresh_failed')
            self.assertNotIn('private', json.dumps(state))
            self.assertFalse(agent.execute_command({'id':'old','kind':'ddns-refresh','expiresAt':'2020-01-01T00:00:00Z'}, state))
            with self.assertRaises(RuntimeError):
                agent.execute_command({'id':'unsafe','kind':'shell','expiresAt':'2099-01-01T00:00:00Z'}, state)
            self.assertEqual(run.call_count, 1)

    def test_http_rejects_redirects_to_avoid_token_forwarding(self):
        # Check the behavior through a local fake HTTPS response handler, not a live token.
        class FakeOpener:
            def open(self, request, timeout):
                self.request = request
                self.timeout = timeout
                class Response:
                    def __enter__(self): return self
                    def __exit__(self, *args): return False
                    def read(self, size): return b'{"accepted":true}'
                return Response()
        fake = FakeOpener()
        with patch.object(agent.urllib.request, 'build_opener', return_value=fake) as build:
            self.assertTrue(agent.post_report({'endpoint':'https://edge.example','hostId':'onecloud','reportToken':'TEST_TOKEN'}, {'safe':True})['accepted'])
            handler = build.call_args.args[1]
            self.assertIsNone(handler.redirect_request(None, None, 302, '', {}, 'https://evil.example'))
            self.assertEqual(fake.request.full_url, 'https://edge.example/api/hosts/onecloud/report')


class HostRegressions(unittest.TestCase):
    def test_del_peer_names_do_not_poison_other_observations(self):
        peers = agent.sanitize_peers([{'route': {'peer_id': 1, 'hostname': 'peer\u007f', 'version': '2.6.4'}, 'peer': {'conns': []}}])
        self.assertNotIn('hostname', peers[0])
        self.assertEqual(peers[0]['peerId'], 1)
        node = agent.sanitize_node({'peer_id': 2, 'hostname': 'host\u007f', 'version': '2.6.4'})
        self.assertEqual(node['hostname'], 'unknown')
        self.assertNotIn('\u007f', json.dumps([peers, node], ensure_ascii=False))
        self.assertEqual(agent.text('😀' * 64), '😀' * 64)
        self.assertIsNone(agent.text('😀' * 65))
        self.assertNotIn('hostname', agent.sanitize_peers([{'route': {'peer_id': 3, 'hostname': '😀' * 65}, 'peer': {'conns': []}}])[0])

    def test_host_identifiers_match_backend_profiles(self):
        base = {'endpoint': 'https://edge.example', 'directHostname': 'ip.example.org', 'instanceName': 'home'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            for host_id in ['edge.office', 'edge-office_2', 'a' * 64]:
                path.write_text(json.dumps({**base, 'hostId': host_id})); path.chmod(0o600)
                self.assertEqual(agent.validate_config(path, True)['hostId'], host_id)
            for host_id in ['_edge', '-edge', 'a' * 65, 'edge/office']:
                path.write_text(json.dumps({**base, 'hostId': host_id}))
                with self.assertRaisesRegex(RuntimeError, 'invalid_host_id'):
                    agent.validate_config(path, True)

    def test_runtime_and_static_units_are_not_persistently_enabled(self):
        for state in ['enabled', 'enabled-runtime', 'static', 'disabled', 'unknown']:
            with self.subTest(state=state), patch.object(agent, 'run', return_value='ActiveState=active\nSubState=running\nUnitFileState=' + state):
                observations = agent.services()
                self.assertTrue(all(service['enabled'] is (state == 'enabled') for service in observations))
                self.assertTrue(all(service['unitFileState'] == state for service in observations))

    def collect_fixture(self, peer_count=256, connections=1, node=None):
        node = node or {'peer_id': 123, 'hostname': 'fixture', 'version': '2.6.4', 'listeners': ['udp://[::]:11010'], 'proxy_cidrs': []}
        peers = [{'route': {'peer_id': index, 'hostname': 'peer-' + str(index), 'version': '2.6.4', 'ipv4_addr': '10.144.1.1/24', 'proxy_cidrs': [], 'cost': 1, 'next_hop_peer_id': 1},
                  'peer': {'conns': [{'is_closed': False, 'tunnel': {'tunnel_type': 'tcp', 'remote_addr': {'url': 'tcp://[2409::1]:11010'}}, 'stats': {'latency_us': 370000, 'rx_bytes': 100000, 'tx_bytes': 100000}, 'loss_rate': 0.0} for _ in range(connections)]}} for index in range(peer_count)]
        ddns = {'name': 'ip.example.org', 'status': 'unchanged', 'ipv6': '2409::1', 'currentIpv6': '2409::1', 'proxied': False, 'lastSuccessAt': '2026-10-05T12:00:00Z'}
        services = [{'unit': unit, 'activeState': 'active', 'subState': 'running', 'enabled': False, 'unitFileState': 'static'} for unit in agent.UNITS]
        ack = {'id': 'request_1', 'status': 'completed', 'completedAt': '2026-10-05T12:00:00Z'}
        with patch.object(agent, 'cli_result', side_effect=[node, peers]), patch.object(agent, 'ddns', return_value=ddns), patch.object(agent, 'services', return_value=services), patch.object(agent, 'now', return_value='2026-10-05T12:00:00Z'):
            report = agent.collect({'hostId': 'onecloud'}, {'ack': ack})
        self.assertEqual(report['ddns'], ddns)
        self.assertEqual(report['services'], services)
        self.assertEqual(report['commandAck'], ack)
        return report

    def test_large_mesh_report_fits_actual_http_bytes_and_keeps_command_ack(self):
        report = self.collect_fixture()
        mesh = report['easytier']
        self.assertEqual(mesh['status'], 'ok')
        self.assertTrue(mesh['truncated'])
        self.assertGreater(mesh['omittedPeers'], 0)
        self.assertEqual(len(mesh['peers']) + mesh['omittedPeers'], 256)
        self.assertEqual([peer['peerId'] for peer in mesh['peers']], list(range(len(mesh['peers']))))
        self.assertTrue(all(len(peer['connections']) == 1 for peer in mesh['peers']))
        encoded = agent.encode_report(report)
        self.assertLessEqual(len(encoded), 65536)
        class FakeOpener:
            def open(self, request, timeout):
                self.request = request
                class Response:
                    def __enter__(self): return self
                    def __exit__(self, *args): return False
                    def read(self, size): return b'{"accepted":true}'
                return Response()
        opener = FakeOpener()
        with patch.object(agent.urllib.request, 'build_opener', return_value=opener):
            agent.post_report({'endpoint': 'https://edge.example', 'hostId': 'onecloud', 'reportToken': 'FAKE_TEST_TOKEN'}, report)
        self.assertEqual(opener.request.data, encoded)
        self.assertEqual(json.loads(opener.request.data)['commandAck'], report['commandAck'])

    def test_schema_list_reductions_are_explicit_and_count_whole_omitted_peers(self):
        node = {'peer_id': 123, 'hostname': 'fixture', 'version': '2.6.4', 'listeners': ['udp://[::]:11010'] * 20, 'proxy_cidrs': ['192.168.1.0/24'] * 40}
        report = self.collect_fixture(peer_count=300, connections=20, node=node)
        mesh = report['easytier']
        self.assertTrue(mesh['truncated'])
        self.assertEqual(len(mesh['peers']) + mesh['omittedPeers'], 300)
        self.assertEqual(len(mesh['node']['listeners']), 16)
        self.assertEqual(len(mesh['node']['proxyCidrs']), 32)
        self.assertTrue(all(len(peer['connections']) == 16 for peer in mesh['peers']))
        self.assertLessEqual(len(agent.encode_report(report)), 65536)
        # Truncating only a list must not invent wholly omitted peers.
        metadata = {}
        agent.sanitize_node(node, metadata)
        self.assertEqual(metadata, {'truncated': True})

    def test_unit_timeout_covers_allowed_collection_refresh_and_followup(self):
        class SimulatedServiceKill(BaseException): pass
        service = Path(__file__).with_name('edgetier-host.service').read_text()
        limit = int(next(line.split('=', 1)[1] for line in service.splitlines() if line.startswith('TimeoutStartSec=')))
        elapsed = [0]
        posts = []
        def advance(seconds):
            elapsed[0] += seconds
            if elapsed[0] > limit:
                raise SimulatedServiceKill()
        def collect(config, state):
            advance(2 * 20 + 15 + 4 * 15)
            return {'easytier': {'peers': []}, 'ddns': {'status': 'unknown'}, **({'commandAck': state['ack']} if state.get('ack') else {})}
        def post(config, report):
            advance(20); posts.append(report)
            return {'accepted': True, **({'command': {'id': 'request_budget', 'kind': 'ddns-refresh', 'expiresAt': '2099-01-01T00:00:00Z'}} if len(posts) == 1 else {})}
        def run(arguments, timeout):
            self.assertEqual(arguments, list(agent.DDNS_COMMAND)); self.assertEqual(timeout, 230)
            advance(230)
            return 'ok'
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / 'state.json'
            real_open = open
            def open_lock(name, *args, **kwargs):
                return real_open(Path(directory) / 'lock' if name == '/run/edgetier-host.lock' else name, *args, **kwargs)
            with patch.object(agent, 'STATE', state_path), patch.object(agent, 'validate_config', return_value={'hostId': 'onecloud'}), patch.object(agent, 'collect', side_effect=collect), patch.object(agent, 'post_report', side_effect=post), patch.object(agent, 'run', side_effect=run), patch.object(agent.fcntl, 'flock'), patch('builtins.open', side_effect=open_lock), patch('sys.argv', ['edgetier-host-agent']), redirect_stdout(io.StringIO()):
                agent.main()
            journal = json.loads(state_path.read_text())
        self.assertEqual(elapsed[0], 500)
        self.assertEqual(len(posts), 2)
        self.assertEqual(posts[1]['commandAck']['status'], 'completed')
        self.assertEqual(journal['ack']['status'], 'completed')
        self.assertNotIn('executingId', journal)


if __name__ == '__main__':
    unittest.main()
