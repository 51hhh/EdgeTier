#!/usr/bin/env python3
"""Credential-free host telemetry and one fixed DDNS refresh operation."""
import argparse
from datetime import datetime, timezone
import fcntl
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION = '1.0.1'
MAX_REPORT_BYTES = 64 * 1024
UNITS = ('easytier-core-home.service', 'easytier-web.service',
         'edgetier-home-cloudflared.service', 'onecloud-ddns.timer')
DDNS_COMMAND = ('/bin/systemctl', 'start', 'onecloud-ddns.service')
STATE = Path('/var/lib/edgetier-host/state.json')
DDNS_STATE = Path('/var/lib/onecloud-ddns/status.json')
CLI = '/opt/easytier/easytier-cli'
PROTOCOLS = {'tcp', 'udp', 'ws', 'wss', 'wg', 'quic'}


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def load_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {} if default is None else default


def atomic_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def run(arguments, timeout=15):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('local_command_failed')
    return result.stdout


def text(value, maximum=128):
    if not isinstance(value, str) or not value or len(value) > maximum:
        return None
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    # The shared TypeScript boundary counts UTF-16 code units, including emoji pairs.
    if len(value.encode('utf-16-le', 'surrogatepass')) > maximum * 2:
        return None
    return value


def number(value, maximum=2**53 - 1):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) and 0 <= value <= maximum else None


def safe_uri(value):
    """Reconstruct transport addresses, dropping userinfo, path and query tokens."""
    try:
        url = urllib.parse.urlsplit(value)
        if url.scheme not in PROTOCOLS or not url.hostname:
            return None
        port = url.port if url.port is not None else {'ws': 80, 'wss': 443}.get(url.scheme)
        if port is None or not 1 <= port <= 65535:
            return None
        host = url.hostname
        if ':' in host:
            host = '[' + str(ipaddress.IPv6Address(host)) + ']'
        elif not re.fullmatch(r'[A-Za-z0-9.-]+', host):
            return None
        return text(url.scheme + '://' + host + ':' + str(port), 512)
    except (TypeError, ValueError):
        return None


def address(value, version=None):
    """Decode CLI strings or exact common.Ipv4Inet/Ipv6Inet JSON shapes.

    EasyTier's protobuf address words use network byte order. Do not treat
    arbitrary JSON scalars or incomplete objects as an invented address.
    """
    try:
        if isinstance(value, dict):
            if set(value) != {'address', 'network_length'}:
                return None
            words, prefix = value['address'], value['network_length']
            if not isinstance(words, dict) or isinstance(prefix, bool) or not isinstance(prefix, int):
                return None
            if set(words) == {'addr'}:
                parts, family = [words['addr']], 4
            elif set(words) == {'part1', 'part2', 'part3', 'part4'}:
                parts, family = [words['part' + str(index)] for index in range(1, 5)], 6
            else:
                return None
            if any(isinstance(part, bool) or not isinstance(part, int) or not 0 <= part <= 0xffffffff
                   for part in parts) or not 0 <= prefix <= (32 if family == 4 else 128):
                return None
            packed = b''.join(part.to_bytes(4, byteorder='big') for part in parts)
            ip = ipaddress.IPv4Address(packed) if family == 4 else ipaddress.IPv6Address(packed)
            interface = ipaddress.ip_interface(str(ip) + '/' + str(prefix))
        elif isinstance(value, str):
            interface = ipaddress.ip_interface(value)
        else:
            return None
        return str(interface) if version is None or interface.version == version else None
    except (TypeError, ValueError):
        return None


def compact(value):
    return {key: item for key, item in value.items() if item is not None}


def limited(values, maximum, truncation=None):
    if len(values) > maximum and truncation is not None:
        truncation['truncated'] = True
    return values[:maximum]


def sanitize_node(raw, truncation=None):
    peer_id = number(raw.get('peer_id'), 2**32 - 1)
    if peer_id is None:
        raise RuntimeError('invalid_node_schema')
    return compact({
        'peerId': peer_id, 'hostname': text(raw.get('hostname')) or 'unknown',
        'version': text(raw.get('version'), 40) or 'unknown',
        'virtualIpv4': address(raw.get('ipv4_addr'), version=4), 'virtualIpv6': address(raw.get('ipv6_addr'), version=6),
        'listeners': limited([safe for value in raw.get('listeners', []) if (safe := safe_uri(value))], 16, truncation),
        'proxyCidrs': limited([safe for value in raw.get('proxy_cidrs', []) if (safe := address(value))], 32, truncation),
    })


def sanitize_peers(raw, truncation=None):
    if not isinstance(raw, list):
        raise RuntimeError('invalid_peer_schema')
    if len(raw) > 256 and truncation is not None:
        truncation['omittedPeers'] = len(raw) - 256
    peers = []
    for entry in limited(raw, 256, truncation):
        route, peer = entry.get('route') or {}, entry.get('peer') or {}
        peer_id = number(route.get('peer_id', peer.get('peer_id')), 2**32 - 1)
        if peer_id is None:
            raise RuntimeError('invalid_peer_schema')
        connections = []
        active_connections = [connection for connection in peer.get('conns', []) if not connection.get('is_closed')]
        for connection in limited(active_connections, 16, truncation):
            tunnel, stats = connection.get('tunnel') or {}, connection.get('stats') or {}
            remote = (tunnel.get('resolved_remote_addr') or tunnel.get('remote_addr') or {}).get('url')
            latency = number(stats.get('latency_us'))
            connections.append(compact({
                'transport': (text(tunnel.get('tunnel_type'), 64) or 'unknown').lower(),
                'remoteAddress': safe_uri(remote),
                'latencyMs': None if latency is None else latency / 1000,
                'lossRate': number(connection.get('loss_rate'), 1),
                'rxBytes': number(stats.get('rx_bytes')) or 0,
                'txBytes': number(stats.get('tx_bytes')) or 0,
            }))
        peers.append(compact({
            'peerId': peer_id, 'hostname': text(route.get('hostname')),
            'version': text(route.get('version'), 40), 'virtualIpv4': address(route.get('ipv4_addr'), version=4),
            'proxyCidrs': limited([safe for value in route.get('proxy_cidrs', []) if (safe := address(value))], 32, truncation),
            'nextHopPeerId': number(route.get('next_hop_peer_id'), 2**32 - 1),
            'cost': number(route.get('cost')), 'connections': connections,
        }))
    return peers


def instance_selector(config):
    """Prefer a stable configured name; legacy UUID selection remains explicit."""
    has_name, has_id = 'instanceName' in config, 'instanceId' in config
    if has_name == has_id:
        raise RuntimeError('invalid_instance_selector')
    if has_name:
        name = config['instanceName']
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', name):
            raise RuntimeError('invalid_instance_name')
        return '-n', name, 'instance_name'
    try:
        identifier = str(uuid.UUID(config['instanceId']))
    except (TypeError, ValueError, AttributeError):
        raise RuntimeError('invalid_instance_id') from None
    return '-i', identifier, 'instance_id'


def cli_result(arguments, config):
    flag, identifier, envelope_key = instance_selector(config)
    raw = json.loads(run([CLI, '-p', '127.0.0.1:15888', flag, identifier,
                          *arguments], timeout=20))
    if isinstance(raw, list) and any(isinstance(entry, dict) and 'result' in entry for entry in raw):
        matching = [entry for entry in raw if isinstance(entry, dict) and 'result' in entry
                    and entry.get(envelope_key) == identifier]
        if len(matching) != 1:
            raise RuntimeError('instance_not_found')
        raw = matching[0]['result']
    return raw


def services():
    result = []
    for unit in UNITS:
        try:
            fields = dict(line.split('=', 1) for line in run([
                'systemctl', 'show', unit, '--property=ActiveState,SubState,UnitFileState',
            ]).splitlines() if '=' in line)
            unit_file_state = fields.get('UnitFileState') or 'unknown'
            result.append({'unit': unit, 'activeState': fields.get('ActiveState') or 'unknown',
                           'subState': fields.get('SubState') or 'unknown',
                           'unitFileState': unit_file_state, 'enabled': unit_file_state == 'enabled'})
        except Exception:
            result.append({'unit': unit, 'activeState': 'unknown', 'subState': 'unknown', 'enabled': False, 'unitFileState': 'unknown'})
    return result


def current_ipv6():
    try:
        interfaces = json.loads(run(['ip', '-j', '-6', 'addr', 'show', 'dev', 'eth0']))
        addresses = set()
        bad = {'temporary', 'tentative', 'deprecated', 'dadfailed'}
        for interface in interfaces:
            if 'UP' not in interface.get('flags', []):
                continue
            for entry in interface.get('addr_info', []):
                if entry.get('family') != 'inet6' or entry.get('scope') != 'global':
                    continue
                if bad.intersection(entry.get('flags', [])) or any(entry.get(flag) for flag in bad):
                    continue
                if entry.get('preferred_life_time') == 0 or entry.get('valid_life_time') == 0:
                    continue
                addr = ipaddress.ip_address(entry['local'])
                if addr in ipaddress.ip_network('2000::/3'):
                    addresses.add(str(addr))
        return addresses.pop() if len(addresses) == 1 else None
    except Exception:
        return None


def ddns(config):
    raw = load_json(DDNS_STATE)
    # This local status file is written exclusively by the existing DDNS writer.
    allowed = ('name', 'status', 'ipv6', 'ttl', 'proxied', 'lastAttemptAt', 'lastSuccessAt', 'errorCode')
    observation = {key: raw[key] for key in allowed if key in raw}
    if raw.get('name') != config['directHostname']:
        observation = {'name': config['directHostname'], 'status': 'unknown'}
    if current := current_ipv6():
        observation['currentIpv6'] = current
    return observation


def encode_report(report):
    # Use this exact encoding for the byte budget and the HTTP body.
    return json.dumps(report, separators=(',', ':'), allow_nan=False).encode()


def bound_report(report):
    """Keep mandatory observations/ack and the largest whole-peer prefix that fits."""
    if len(encode_report(report)) <= MAX_REPORT_BYTES:
        return report
    mesh = report['easytier']
    peers = mesh['peers']
    prior_omitted = mesh.get('omittedPeers', 0)
    mesh['truncated'] = True
    # Include metadata in every measurement; no peer is partially represented.
    low, high = 0, len(peers)
    while low < high:
        count = (low + high + 1) // 2
        mesh['peers'] = peers[:count]
        mesh['omittedPeers'] = prior_omitted + len(peers) - count
        if len(encode_report(report)) <= MAX_REPORT_BYTES:
            low = count
        else:
            high = count - 1
    mesh['peers'] = peers[:low]
    mesh['omittedPeers'] = prior_omitted + len(peers) - low
    if not mesh['omittedPeers']:
        mesh.pop('omittedPeers', None)
    if len(encode_report(report)) > MAX_REPORT_BYTES:
        raise RuntimeError('report_base_too_large')
    return report


def collect(config, state):
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if state.get('bootId') != boot:
        state['sequence'] = 0
    state['bootId'] = boot
    state['sequence'] = state.get('sequence', 0) + 1
    try:
        truncation = {}
        mesh = {'status': 'ok', 'node': sanitize_node(cli_result(['-o', 'json', 'node', 'info'], config), truncation),
                'peers': sanitize_peers(cli_result(['-v', '-o', 'json', 'peer', 'list'], config), truncation), **truncation}
    except Exception:
        mesh = {'status': 'error', 'peers': [], 'errorCode': 'easytier_collection_failed'}
    report = {'schemaVersion': 1, 'hostId': config['hostId'], 'reportId': str(uuid.uuid4()),
              'bootId': boot, 'sequence': state['sequence'], 'capturedAt': now(),
              'collectorVersion': VERSION, 'ddns': ddns(config), 'services': services(), 'easytier': mesh}
    if state.get('ack'):
        report['commandAck'] = state['ack']
    return bound_report(report)


def post_report(config, report):
    endpoint = config['endpoint'].rstrip('/') + '/api/hosts/' + config['hostId'] + '/report'
    body = encode_report(report)
    if len(body) > MAX_REPORT_BYTES:
        raise RuntimeError('host_report_too_large')
    request = urllib.request.Request(endpoint, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['reportToken'],
        'User-Agent': 'edgetier-host/' + VERSION,
    })
    # Never inherit desktop/global proxy credentials or forward the token after redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=20) as response:
        data = response.read(65537)
        if len(data) > 65536:
            raise RuntimeError('report_response_too_large')
        return json.loads(data)


def execute_command(command, state):
    if command.get('kind') != 'ddns-refresh' or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', command.get('id', '')):
        raise RuntimeError('invalid_command')
    deadline = datetime.fromisoformat(command['expiresAt'].replace('Z', '+00:00'))
    if deadline <= datetime.now(timezone.utc):
        return False
    if state.get('executingId') == command['id'] or (state.get('ack') or {}).get('id') == command['id']:
        return False
    state['executingId'] = command['id']
    atomic_json(STATE, state)  # A crash cannot cause an untracked second execution.
    error = None
    try:
        run(list(DDNS_COMMAND), timeout=230)
    except Exception:
        error = 'ddns_refresh_failed'
    state['ack'] = compact({'id': command['id'], 'status': 'failed' if error else 'completed',
                            'completedAt': now(), 'errorCode': error})
    state.pop('executingId', None)
    atomic_json(STATE, state)
    return True


def validate_config(path, dry_run):
    if path.stat().st_mode & 0o077:
        raise RuntimeError('config_permissions')
    config = json.loads(path.read_text())
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', config.get('hostId', '')):
        raise RuntimeError('invalid_host_id')
    instance_selector(config)
    if not re.fullmatch(r'[A-Za-z0-9.-]{1,253}', config.get('directHostname', '')):
        raise RuntimeError('invalid_hostname')
    url = urllib.parse.urlsplit(config['endpoint'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise RuntimeError('invalid_endpoint')
    if not dry_run and not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', config.get('reportToken', '')):
        raise RuntimeError('invalid_report_token')
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('/etc/edgetier-host/config.json'))
    parser.add_argument('--dry-run', action='store_true', help='Print sanitized report, perform no upload or command')
    args = parser.parse_args()
    config = validate_config(args.config, args.dry_run)
    with open('/run/edgetier-host.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = load_json(STATE)
        if state.get('executingId'):
            state['ack'] = {'id': state.pop('executingId'), 'status': 'failed',
                            'completedAt': now(), 'errorCode': 'execution_interrupted'}
        report = collect(config, state)
        if args.dry_run:
            print(json.dumps(report))
            return
        atomic_json(STATE, state)
        response = post_report(config, report)
        if response.get('accepted') is not True and response.get('duplicate') is not True:
            raise RuntimeError('report_not_accepted')
        command = response.get('command')
        if command and execute_command(command, state):
            followup = collect(config, state)
            atomic_json(STATE, state)
            post_report(config, followup)
        print(json.dumps({'status': 'reported', 'hostId': config['hostId'],
                          'peerCount': len(report['easytier']['peers']), 'ddnsStatus': report['ddns']['status']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Za-z0-9_]{1,100}', str(error)) else type(error).__name__
        print(json.dumps({'status': 'error', 'errorCode': code}), file=sys.stderr)
        sys.exit(1)
