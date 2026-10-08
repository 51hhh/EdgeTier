"""Isolated rollout main() checks: no root paths, credentials or network calls."""
import argparse
from contextlib import ExitStack, redirect_stdout
from email import policy
from email.parser import BytesParser
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('rollout', Path(__file__).with_name('rollout-edgetier.py'))
rollout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollout)


class FakeCloudflare:
    """Every urllib operation is intercepted; unexpected calls fail closed."""

    def __init__(self, settings):
        self.settings = settings
        self.uploaded = False
        self.metadata = None
        self.requests = []

    @staticmethod
    def deployment(version='fixture-active-version'):
        return {'deployments': [{'versions': [{'version_id': version, 'percentage': 100}]}]}

    def open(self, request, timeout):
        if not request.full_url.startswith(rollout.API_BASE):
            raise AssertionError('unexpected network destination')
        path = request.full_url[len(rollout.API_BASE):]
        method = request.get_method()
        self.requests.append((method, path))
        base = '/accounts/fixture-account/workers/scripts/edgetier'
        if method == 'GET' and path == base + '/deployments':
            value = self.deployment('fixture-new-version' if self.uploaded else 'fixture-active-version')
        elif method == 'GET' and path == base + '/settings':
            value = self.settings
        elif method == 'GET' and path == '/accounts/fixture-account/workers/scripts':
            value = [{'id': 'edgetier', 'migration_tag': 'host-management-v1'}]
        elif method == 'POST' and path == base + '/assets-upload-session':
            value = {'jwt': 'fixture-upload-jwt', 'buckets': []}
        elif method == 'GET' and path == base + '/versions':
            value = {'items': [{'id': 'fixture-active-version'}]}
        elif method == 'PUT' and path == base + '?bindings_inherit=strict&excludeScript=true':
            if self.uploaded:
                raise AssertionError('unexpected second script upload')
            mime = request.get_header('Content-type')
            message = BytesParser(policy=policy.default).parsebytes(
                ('Content-Type: ' + mime + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + request.data)
            parts = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True)
                     for part in message.iter_parts()}
            if set(parts) != {'metadata', 'index.js', 'legacy.js', 'modern.js'}:
                raise AssertionError('unexpected Worker upload parts')
            self.metadata = json.loads(parts['metadata'])
            self.uploaded = True
            value = {'id': 'fixture-new-version'}
        else:
            raise AssertionError('unexpected mocked Cloudflare operation: ' + method + ' ' + path)
        return io.BytesIO(json.dumps({'success': True, 'result': value}).encode())


class CodeOnlyRollout(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.backup = self.root / 'backup'
        self.bundle = self.root / 'bundle'
        (self.backup / 'modules').mkdir(parents=True)
        (self.bundle / 'client').mkdir(parents=True)
        self.host_config = self.root / 'etc/edgetier-host/config.json'
        self.provider_config = self.root / 'etc/onecloud-ddns/config.json'
        self.provider_config.parent.mkdir(parents=True)
        # Invented fixture values; no user's provider/collector credentials are read.
        self.provider_config.write_text(json.dumps({'api_token': 'fixture-provider-token'}))
        self.settings = {'compatibility_date': '2026-06-09', 'compatibility_flags': ['nodejs_compat'],
            'bindings': [
                {'name': 'RELAY_ROOM', 'type': 'durable_object_namespace', 'class_name': 'RelayRoom'},
                {'name': 'DIRECTORY', 'type': 'durable_object_namespace', 'class_name': 'Directory'},
                {'name': 'CONFIG_SERVER_PROBE', 'type': 'durable_object_namespace', 'class_name': 'ConfigServerProbe'},
                {'name': 'HOST_STATE', 'type': 'durable_object_namespace', 'class_name': 'HostState'},
                {'name': 'HOST_PROFILES', 'type': 'plain_text', 'text': json.dumps([
                    {'hostId': 'custom.home', 'roomId': 'custom-room', 'networkName': 'custom-mesh'},
                    {'hostId': 'second-host', 'roomId': 'second-room', 'networkName': 'second-mesh'}])},
                # Cloudflare does not return the secret value; it must be inherited.
                {'name': 'HOST_REPORT_TOKENS', 'type': 'secret_text'},
                {'name': 'FIXTURE_LIVE_SETTING', 'type': 'plain_text', 'text': 'changed-after-prior-rollout'},
                {'name': 'ASSETS', 'type': 'assets'},
            ]}
        self.write_json(self.backup / 'rollout.json', {'script': 'edgetier', 'accountId': 'fixture-account'})
        baseline_settings = {**self.settings, 'bindings': [binding for binding in self.settings['bindings'] if binding['name'] != 'FIXTURE_LIVE_SETTING']}
        self.write_json(self.backup / 'settings.json', baseline_settings)
        self.write_json(self.backup / 'script-metadata.json', {'migration_tag': 'v2'})
        self.write_json(self.backup / 'deployments.json', FakeCloudflare.deployment('fixture-before-migration'))
        self.write_json(self.backup / 'deployment-after.json', FakeCloudflare.deployment())
        (self.backup / 'modules/index.js').write_text('export class RelayRoom {}\nexport class Directory {}\nexport class ConfigServerProbe {}\n')
        (self.bundle / 'modern.js').write_text('export class HostState {}\nexport class RelayRoom {}\n')
        (self.bundle / 'edge-extension.js').write_text(Path(__file__).with_name('edge-extension.js').read_text())
        self.write_json(self.bundle / 'release.json', {'version': '0.2.2', 'target': 'edgetier', 'relayImplementation': 'modern'})
        (self.bundle / 'client/index.html').write_text('<!doctype html><title>Fixture</title>')

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value))

    def run_code_only(self, release_version='0.2.2', forward_recovery=False, code_only=True):
        cloud = FakeCloudflare(self.settings)
        self.last_cloud = cloud
        self.root_path_calls = []
        args = argparse.Namespace(backup=self.backup, bundle=self.bundle, code_only=code_only, release_version=release_version, forward_recovery=forward_recovery)

        def rooted_path(value):
            self.root_path_calls.append(value)
            if value == '/etc/onecloud-ddns/config.json':
                return self.provider_config
            if value == '/etc/edgetier-host/config.json':
                return self.host_config
            raise AssertionError('unexpected root path: ' + str(value))

        output = io.StringIO()
        with ExitStack() as stack:
            stack.enter_context(patch.object(rollout, 'Path', side_effect=rooted_path))
            stack.enter_context(patch.object(rollout.argparse.ArgumentParser, 'parse_args', return_value=args))
            stack.enter_context(patch.object(rollout.urllib.request, 'build_opener', return_value=cloud))
            stack.enter_context(patch.object(rollout.urllib.request, 'urlopen', side_effect=AssertionError('unmocked network call')))
            stack.enter_context(patch.object(rollout.secrets, 'token_urlsafe', side_effect=AssertionError('code-only must not create host tokens')))
            stack.enter_context(patch.object(rollout.os, 'umask'))
            stack.enter_context(redirect_stdout(output))
            rollout.main()
        summary = json.loads(output.getvalue())
        self.assertTrue(summary['deployed'])
        self.assertEqual(summary['releaseVersion'], release_version)
        implementation = 'legacy-recovery' if forward_recovery else 'modern'
        self.assertEqual(summary['relayImplementation'], implementation)
        self.assertEqual(summary['newBindings'], [])
        self.assertTrue(cloud.uploaded)
        self.assertIsNotNone(cloud.metadata)
        bindings = {binding['name']: binding for binding in cloud.metadata['bindings']}
        for binding in self.settings['bindings']:
            name = binding['name']
            if name != 'ASSETS':
                self.assertEqual(bindings[name], {'name': name, 'type': 'inherit', 'version_id': 'latest'})
        expected_names = {binding['name'] for binding in self.settings['bindings']}
        self.assertEqual(set(bindings), expected_names)
        self.assertEqual(bindings['ASSETS'], {'name': 'ASSETS', 'type': 'assets'})
        self.assertNotIn('migrations', cloud.metadata)
        self.assertIn(release_version, cloud.metadata['annotations']['workers/message'])
        recorded = json.loads((self.backup / 'release-manifest.json').read_text())
        self.assertEqual(recorded['version'], release_version)
        self.assertEqual(recorded['baselineVersion'], 'fixture-active-version')
        self.assertTrue(recorded['codeOnly'])
        recovery = (self.backup / 'recovery-index.js').read_text()
        rollout.validate_entry(recovery, release_version, 'legacy-recovery')
        self.assertIn("gateUrl.pathname = '/api/auth/me'", recovery)
        self.assertIn('REPORT_PATH.test(path)', recovery)
        recovery_manifest = json.loads((self.backup / 'recovery-release.json').read_text())
        self.assertEqual(recovery_manifest['relayImplementation'], 'legacy-recovery')
        self.assertFalse((self.backup / 'host-config-new.json').exists())
        self.assertFalse((self.backup / 'host-config-before.json').exists())
        return cloud

    def assert_rejected_before_privileged_io(self, code, version='0.2.2', **options):
        with self.assertRaisesRegex(RuntimeError, '^' + code + '$'):
            self.run_code_only(version, **options)
        self.assertEqual(self.last_cloud.requests, [])
        self.assertEqual(self.root_path_calls, [])

    def test_missing_release_manifest_is_rejected_before_credentials_or_api(self):
        (self.bundle / 'release.json').unlink()
        self.assert_rejected_before_privileged_io('invalid_release_manifest')

    def test_wrong_manifest_version_or_target_is_rejected_before_api(self):
        self.write_json(self.bundle / 'release.json', {'version': '0.2.0', 'target': 'other-worker', 'relayImplementation': 'modern'})
        self.assert_rejected_before_privileged_io('release_manifest_mismatch')

    def test_entry_version_mismatch_is_rejected_before_api(self):
        (self.bundle / 'edge-extension.js').write_text('export const RELEASE_VERSION = "0.2.0";\n')
        self.assert_rejected_before_privileged_io('release_entry_version_mismatch')

    def test_invalid_release_version_is_rejected_before_privileged_io(self):
        self.assert_rejected_before_privileged_io('invalid_release_version', '00.2.1')

    def use_recovery_bundle(self):
        entry = Path(__file__).with_name('edge-extension.js').read_text()
        (self.bundle / 'edge-extension.js').write_text(rollout.recovery_entry(entry))
        self.write_json(self.bundle / 'release.json', {'version': '0.2.2', 'target': 'edgetier', 'relayImplementation': 'legacy-recovery'})

    def test_forward_recovery_preserves_bindings_without_migrations_or_config_bootstrap(self):
        self.use_recovery_bundle()
        self.run_code_only(forward_recovery=True)
        self.assertFalse(self.host_config.exists())

    def test_recovery_bundle_requires_explicit_recovery_mode(self):
        self.use_recovery_bundle()
        self.assert_rejected_before_privileged_io('release_manifest_mismatch')

    def test_recovery_mode_rejects_normal_bundle_and_initial_migration(self):
        self.assert_rejected_before_privileged_io('release_manifest_mismatch', forward_recovery=True)
        self.assert_rejected_before_privileged_io('recovery_requires_code_only', forward_recovery=True, code_only=False)

    def test_recovery_mode_rejects_wrong_relay_export_before_privileged_io(self):
        self.use_recovery_bundle()
        entry = (self.bundle / 'edge-extension.js').read_text()
        entry = entry.replace("import legacy, { RelayRoom, Directory, ConfigServerProbe } from './legacy.js';", "import legacy, { Directory, ConfigServerProbe } from './legacy.js';")
        (self.bundle / 'edge-extension.js').write_text(entry)
        self.assert_rejected_before_privileged_io('release_entry_export_mismatch', forward_recovery=True)

    def test_code_only_preserves_custom_collector_bytes_mode_and_mtime(self):
        self.host_config.parent.mkdir(parents=True)
        customized = b'{\n  "hostId": "custom.home", "instanceName": "custom-core",\n  "endpoint": "https://custom.example.org", "directHostname": "v6.custom.example.org",\n  "reportToken": "fixture-custom-token", "customSetting": {"interval": 75}\n}\n'
        self.host_config.write_bytes(customized)
        self.host_config.chmod(0o640)
        os.utime(self.host_config, ns=(1640995200123456789, 1640995200987654321))
        before = self.host_config.stat()
        self.run_code_only()
        after = self.host_config.stat()
        self.assertEqual(self.host_config.read_bytes(), customized)
        self.assertEqual(after.st_mode, before.st_mode)
        self.assertEqual(after.st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(after.st_ino, before.st_ino)

    def test_code_only_does_not_bootstrap_a_missing_local_collector_config(self):
        self.assertFalse(self.host_config.parent.exists())
        self.run_code_only()
        self.assertFalse(self.host_config.exists())
        self.assertFalse(self.host_config.parent.exists())


if __name__ == '__main__':
    unittest.main()
