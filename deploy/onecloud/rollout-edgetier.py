#!/usr/bin/env python3
"""OneCloud-local deployment; existing Cloudflare credentials never leave this host."""
import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
from pathlib import Path
import secrets
import shutil
import urllib.error
import urllib.request
import uuid

API_BASE = 'https://api.cloudflare.com/client/v4'


def multipart(parts):
    boundary = 'edgetier-' + uuid.uuid4().hex
    body = bytearray()
    for name, filename, mime, content in parts:
        body.extend(('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"; filename="' + filename + '"\r\nContent-Type: ' + mime + '\r\n\r\n').encode())
        body.extend(content)
        body.extend(b'\r\n')
    body.extend(('--' + boundary + '--\r\n').encode())
    return bytes(body), 'multipart/form-data; boundary=' + boundary



def validate_entry(entry, version, implementation):
    def declaration(name):
        values = re.findall(r"\bexport\s+const\s+" + name + r"\s*=\s*(['\"])([^'\"]+)\1", entry)
        return values[0][1] if len(values) == 1 else None
    if declaration('RELEASE_VERSION') != version:
        raise RuntimeError('release_entry_version_mismatch')
    if declaration('RELAY_IMPLEMENTATION') != implementation:
        raise RuntimeError('release_entry_implementation_mismatch')
    imports = {}
    for variable, names, quote, module in re.findall(r"import\s+(legacy|modern),\s*\{([^}]+)\}\s*from\s*(['\"])\./(legacy|modern)\.js\3\s*;", entry):
        if variable != module or variable in imports:
            raise RuntimeError('release_entry_export_mismatch')
        imports[variable] = {name.strip() for name in names.split(',')}
    expected = {'legacy': {'Directory', 'ConfigServerProbe'}, 'modern': {'HostState', 'RelayRoom'}}
    if implementation == 'legacy-recovery':
        expected = {'legacy': {'RelayRoom', 'Directory', 'ConfigServerProbe'}, 'modern': {'HostState'}}
    exports = re.findall(r"\bexport\s*\{([^}]+)\}\s*;", entry)
    if imports != expected or len(exports) != 1 or {name.strip() for name in exports[0].split(',')} != {'RelayRoom', 'Directory', 'ConfigServerProbe', 'HostState'}:
        raise RuntimeError('release_entry_export_mismatch')


def recovery_entry(entry):
    replacements = [
        ("import legacy, { Directory, ConfigServerProbe } from './legacy.js';", "import legacy, { RelayRoom, Directory, ConfigServerProbe } from './legacy.js';"),
        ("import modern, { RelayRoom, HostState } from './modern.js';", "import modern, { HostState } from './modern.js';"),
        ("export const RELAY_IMPLEMENTATION = 'modern';", "export const RELAY_IMPLEMENTATION = 'legacy-recovery';"),
    ]
    for original, replacement in replacements:
        if entry.count(original) != 1:
            raise RuntimeError('unsupported_recovery_adapter_layout')
        entry = entry.replace(original, replacement)
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--forward-recovery', action='store_true', help='Explicit code-only recovery using the preserved legacy relay; keep host/admin routing')
    parser.add_argument('--release-version', required=True, help='Exact release version from the bundle manifest')
    parser.add_argument('--code-only', action='store_true', help='Update an already-migrated deployment, preserving host credentials/state')
    args = parser.parse_args()
    os.umask(0o077)
    if args.forward_recovery and not args.code_only:
        raise RuntimeError('recovery_requires_code_only')
    implementation = 'legacy-recovery' if args.forward_recovery else 'modern'
    release_version = args.release_version
    if not isinstance(release_version, str) or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', release_version) or len(release_version) > 64:
        raise RuntimeError('invalid_release_version')
    try:
        release_manifest = json.loads((args.bundle/'release.json').read_text())
    except (OSError, ValueError):
        raise RuntimeError('invalid_release_manifest') from None
    if not isinstance(release_manifest, dict) or release_manifest.get('version') != release_version or release_manifest.get('target') != 'edgetier' or release_manifest.get('relayImplementation') != implementation:
        raise RuntimeError('release_manifest_mismatch')
    entry = (args.bundle/'edge-extension.js').read_text()
    validate_entry(entry, release_version, implementation)
    recovery = entry if args.forward_recovery else recovery_entry(entry)
    validate_entry(recovery, release_version, 'legacy-recovery')
    config = json.loads(Path('/etc/onecloud-ddns/config.json').read_text())
    baseline = json.loads((args.backup/'rollout.json').read_text())
    settings = json.loads((args.backup/'settings.json').read_text())
    script_info = json.loads((args.backup/'script-metadata.json').read_text())
    deployments = json.loads((args.backup/'deployments.json').read_text())
    active = deployments['deployments'][0]['versions']
    if len(active) != 1 or active[0]['percentage'] != 100:
        raise RuntimeError('baseline_not_single_version')
    if not args.code_only and script_info.get('migration_tag') != 'v2':
        raise RuntimeError('unexpected_production_migration')
    if baseline['script'] != 'edgetier':
        raise RuntimeError('unexpected_target')
    legacy = args.backup/'modules/index.js'
    if not legacy.is_file() or 'ConfigServerProbe' not in legacy.read_text():
        raise RuntimeError('missing_preserved_legacy_class')
    auth = {'Content-Type': 'application/json'}
    if config.get('api_token'):
        auth['Authorization'] = 'Bearer ' + config['api_token']
    else:
        auth.update({'X-Auth-Email': config['email'], 'X-Auth-Key': config['api_key']})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    account = baseline['accountId']
    base = '/accounts/' + account + '/workers/scripts/edgetier'

    def call(path, method='GET', data=None, headers=None):
        request = urllib.request.Request(API_BASE + path, method=method, data=data, headers=headers or auth)
        try:
            with opener.open(request, timeout=60) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            payload = error.read()
            # Retain diagnostics root-only, print only provider numeric codes later.
            (args.backup/'last-api-error.json').write_bytes(payload)
            try:
                codes = [str(item.get('code')) for item in json.loads(payload).get('errors', [])]
            except ValueError:
                codes = []
            raise RuntimeError('cloudflare_http_' + str(error.code) + '_' + '_'.join(codes)) from None
        if not result.get('success'):
            (args.backup/'last-api-error.json').write_text(json.dumps(result))
            raise RuntimeError('cloudflare_request_rejected')
        return result['result']

    current_deployments = call(base+'/deployments')
    current = current_deployments['deployments'][0]['versions']
    if args.code_only:
        prior = json.loads((args.backup/'deployment-after.json').read_text())['deployments'][0]['versions']
        if current != prior:
            raise RuntimeError('production_changed_since_last_rollout')
        active = current
        settings = call(base+'/settings')
        scripts = call('/accounts/'+account+'/workers/scripts')
        live_script = next(item for item in scripts if item.get('id') == 'edgetier')
        if live_script.get('migration_tag') != 'host-management-v1':
            raise RuntimeError('unexpected_code_only_migration')
        (args.backup/'code-only-settings-before.json').write_text(json.dumps(settings))
        (args.backup/'code-only-deployment-before.json').write_text(json.dumps(current_deployments))
    if current != active:
        raise RuntimeError('production_changed_since_backup')
    hashes, manifest = {}, {}
    for path in sorted((args.bundle/'client').rglob('*')):
        if not path.is_file():
            continue
        rel = path.relative_to(args.bundle/'client').as_posix()
        if path.suffix not in ('.html', '.js', '.css', '.svg', '.png', '.jpg', '.webp', '.ico', '.woff2'):
            raise RuntimeError('unexpected_asset_type')
        content = path.read_bytes()
        encoded = base64.b64encode(content)
        hash_id = hashlib.sha256(encoded + path.suffix[1:].encode()).hexdigest()[:32]
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if path.suffix == '.js':
            mime = 'application/javascript'
        hashes[hash_id] = (encoded, mime)
        manifest['/'+rel] = {'hash':hash_id, 'size':len(content)}
    if not manifest or '/index.html' not in manifest:
        raise RuntimeError('missing_client_assets')
    session = call(base+'/assets-upload-session', 'POST', json.dumps({'manifest':manifest}).encode())
    upload_auth = {'Authorization':'Bearer '+session['jwt']}
    completion = session['jwt'] if not session.get('buckets') else None
    for bucket in session.get('buckets', []):
        content, mime = multipart([(hash_id, hash_id, hashes[hash_id][1], hashes[hash_id][0]) for hash_id in bucket])
        result = call('/accounts/'+account+'/workers/assets/upload?base64=true', 'POST', content,
                      {**upload_auth, 'Content-Type':mime})
        if result.get('jwt'):
            completion = result['jwt']
    if not completion:
        raise RuntimeError('asset_upload_not_completed')

    host_config = Path('/etc/edgetier-host/config.json')
    pending_config = None
    if not args.code_only:
        host_config.parent.mkdir(mode=0o700, exist_ok=True)
        if host_config.exists():
            shutil.copy2(host_config, args.backup/'host-config-before.json')
            report_config = json.loads(host_config.read_text())
            report_token = report_config.get('reportToken') or secrets.token_urlsafe(48)
        else:
            report_token = secrets.token_urlsafe(48)
        profile = {'hostId':'onecloud','displayName':'OneCloud','roomId':'home-mesh',
                   'networkName':'home-mesh','directHostname':'ip.ziyourufeng.eu.org','directPort':11010}
        report_config = {'hostId':'onecloud','instanceName':'home-kwrt','directHostname':profile['directHostname'],
                         'endpoint':'https://edgetier.ziyourufeng.eu.org','reportToken':report_token}
        pending_config = args.backup/'host-config-new.json'
        pending_config.write_text(json.dumps(report_config));pending_config.chmod(0o600)
    version_id = active[0]['version_id']
    # Script PUT only supports the literal latest; verify it equals active before upload.
    if args.code_only:
        # Cloud profiles/tokens and local collector identity remain unchanged.
        bindings = [{'name':binding['name'],'type':'inherit','version_id':'latest'}
                    for binding in settings['bindings'] if binding['name'] != 'ASSETS']
        bindings.append({'name':'ASSETS','type':'assets'})
    else:
        bindings = [{'name':binding['name'],'type':'inherit','version_id':'latest'}
                    for binding in settings['bindings'] if binding['name'] not in ('ASSETS','HOST_STATE','HOST_PROFILES','HOST_REPORT_TOKENS')]
        bindings.extend([{'name':'ASSETS','type':'assets'},
                         {'name':'HOST_STATE','type':'durable_object_namespace','class_name':'HostState'},
                         {'name':'HOST_PROFILES','type':'plain_text','text':json.dumps([profile])},
                         {'name':'HOST_REPORT_TOKENS','type':'secret_text','text':json.dumps({'onecloud':report_token})}])
    metadata = {key:settings[key] for key in ['placement','compatibility_date','compatibility_flags','usage_model','tags','tail_consumers','logpush'] if key in settings}
    metadata.update({'main_module':'index.js','bindings':bindings,
                     'assets':{'jwt':completion,'config':{'not_found_handling':'single-page-application','run_worker_first':True}},
                     'migrations':{'old_tag':'v2','new_tag':'host-management-v1','steps':[{'new_sqlite_classes':['HostState']}]},
                     'annotations':{'workers/message':'EdgeTier '+release_version+': '+implementation+' RelayRoom; preserve legacy management and bridge'}})
    if args.code_only:
        metadata.pop('migrations')
    # Recovery changes only the RelayRoom import. Full adapter gates and host APIs remain.
    (args.backup/'recovery-index.js').write_text(recovery)
    (args.backup/'recovery-release.json').write_text(json.dumps({**release_manifest, 'relayImplementation': 'legacy-recovery'}))
    shutil.copy2(args.bundle/'modern.js',args.backup/'modern.js')
    (args.backup/'asset-manifest.json').write_text(json.dumps(manifest))
    (args.backup/'release-manifest.json').write_text(json.dumps({**release_manifest, 'baselineVersion': version_id, 'codeOnly': args.code_only}))
    parts = [('metadata','metadata','application/json',json.dumps(metadata).encode()),
             ('index.js','index.js','application/javascript+module',(args.bundle/'edge-extension.js').read_bytes()),
             ('legacy.js','legacy.js','application/javascript+module',legacy.read_bytes()),
             ('modern.js','modern.js','application/javascript+module',(args.bundle/'modern.js').read_bytes())]
    content,mime = multipart(parts)
    versions = call(base+'/versions')['items']
    if not versions or versions[0]['id'] != version_id or call(base+'/deployments')['deployments'][0]['versions'] != active:
        raise RuntimeError('latest_version_is_not_verified_baseline')
    result = call(base+'?bindings_inherit=strict&excludeScript=true', 'PUT', content,
                  {**auth,'Content-Type':mime})
    (args.backup/'upload-result.json').write_text(json.dumps(result))
    actual = call(base+'/settings')
    names={binding['name'] for binding in actual.get('bindings',[])}
    required={binding['name'] for binding in settings['bindings']} | {'HOST_STATE','HOST_PROFILES','HOST_REPORT_TOKENS'}
    if not required.issubset(names):
        raise RuntimeError('post_deploy_missing_bindings')
    if pending_config is not None:
        shutil.copy2(pending_config,host_config);host_config.chmod(0o600)
    (args.backup/'deployment-after.json').write_text(json.dumps(call(base+'/deployments')))
    print(json.dumps({'deployed':True,'releaseVersion':release_version,'relayImplementation':implementation,'preservedBindings':len(settings['bindings']),
                      'newBindings':[] if args.code_only else ['HOST_STATE','HOST_PROFILES','HOST_REPORT_TOKENS'],
                      'legacyIntegrationsPreserved':True,'assetCount':len(manifest),'backup':str(args.backup)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) else type(error).__name__
        print(json.dumps({'deployed':False,'errorCode':code}))
        raise SystemExit(1)
