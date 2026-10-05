#!/usr/bin/env python3
"""Maintain OneCloud's DNS-only AAAA using a verified eth0 IPv6 address."""
import argparse
from datetime import datetime, timezone
import fcntl
import ipaddress
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG = Path('/etc/onecloud-ddns/config.json')
STATUS = Path('/var/lib/onecloud-ddns/status.json')
GLOBAL_UNICAST = ipaddress.ip_network('2000::/3')
BAD_FLAGS = {'temporary', 'tentative', 'deprecated', 'dadfailed'}


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def persist_status(observation):
    """Persist only the credential-free fields consumed by EdgeTier."""
    allowed = {'name', 'status', 'ipv6', 'ttl', 'proxied', 'lastAttemptAt',
               'lastSuccessAt', 'errorCode'}
    clean = {key: value for key, value in observation.items() if key in allowed}
    STATUS.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = STATUS.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(clean, output)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, STATUS)


def previous_status():
    try:
        previous = json.loads(STATUS.read_text())
        return {key: previous[key] for key in ['name', 'ipv6', 'ttl', 'proxied', 'lastSuccessAt']
                if key in previous}
    except (OSError, ValueError, TypeError):
        return {}


def safe_error(error):
    message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    return message.lower() if re.fullmatch(r'[A-Za-z0-9_]{1,64}', message) else 'ddns_operation_failed'


def run_json(command):
    return json.loads(subprocess.check_output(command, timeout=10))


def candidates(interfaces, interface):
    addresses = set()
    for item in interfaces:
        if item.get('ifname') != interface or 'UP' not in item.get('flags', []):
            continue
        for info in item.get('addr_info', []):
            if info.get('family') != 'inet6' or info.get('scope') != 'global':
                continue
            if BAD_FLAGS.intersection(info.get('flags', [])) or any(info.get(f) for f in BAD_FLAGS):
                continue
            if info.get('preferred_life_time') == 0 or info.get('valid_life_time') == 0:
                continue
            address = ipaddress.ip_address(info['local'])
            if address in GLOBAL_UNICAST:
                addresses.add(str(address))
    return sorted(addresses)


def select_verified(addresses, verified, routes, interface):
    eligible = set(addresses).intersection(verified)
    if len(eligible) == 1:
        return eligible.pop()
    sources = set()
    for route in routes:
        if route.get('dev') != interface:
            continue
        source = route.get('prefsrc') or route.get('src')
        if source:
            source = str(ipaddress.ip_address(source))
            if source in eligible:
                sources.add(source)
    if len(sources) == 1:
        return sources.pop()
    raise RuntimeError('no_unambiguous_verified_ipv6')


def probe(address):
    result = subprocess.run([
        'curl', '--noproxy', '*', '-6', '--interface', address,
        '--connect-timeout', '5', '--max-time', '12', '-fsS',
        'https://www.cloudflare.com/cdn-cgi/trace',
    ], capture_output=True, text=True, timeout=15)
    if result.returncode:
        return False
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    try:
        return ipaddress.ip_address(values.get('ip', '')) == ipaddress.ip_address(address)
    except ValueError:
        return False


def api(config, path, method='GET', payload=None):
    headers = {'Content-Type': 'application/json', 'User-Agent': 'onecloud-ddns/1'}
    if config.get('api_token'):
        headers['Authorization'] = 'Bearer ' + config['api_token']
    else:
        headers.update({'X-Auth-Email': config['email'], 'X-Auth-Key': config['api_key']})
    url = 'https://api.cloudflare.com/client/v4/zones/' + config['zone_id'] + path
    request = urllib.request.Request(url, headers=headers, method=method,
                                    data=None if payload is None else json.dumps(payload).encode())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError('cloudflare_http_' + str(error.code)) from None
    if not result.get('success'):
        codes = [str(error.get('code')) for error in result.get('errors', [])]
        raise RuntimeError('cloudflare_rejected_' + '_'.join(codes))
    return result


def matches(record, desired):
    try:
        return (record.get('name') == desired['name'] and record.get('type') == 'AAAA'
                and ipaddress.ip_address(record.get('content', '')) == ipaddress.ip_address(desired['content'])
                and record.get('ttl') == desired['ttl'] and record.get('proxied') is False)
    except ValueError:
        return False


def update(config, address):
    query = urllib.parse.urlencode({'name': config['name'], 'per_page': 100})
    listing = api(config, '/dns_records?' + query)
    records = listing['result']
    info = listing.get('result_info', {})
    if len(records) != 1 or info.get('total_pages', 1) > 1:
        raise RuntimeError('ambiguous_dns_records')
    record = records[0]
    if record.get('id') != config['record_id'] or record.get('name') != config['name']:
        raise RuntimeError('dns_record_identity_mismatch')
    if record.get('type') not in ('A', 'AAAA'):
        raise RuntimeError('unexpected_dns_record_type')
    desired = {'type': 'AAAA', 'name': config['name'], 'content': address,
               'ttl': config['ttl'], 'proxied': False}
    changed = not matches(record, desired)
    if changed:
        for key in ['comment', 'tags']:
            if key in record:
                desired[key] = record[key]
        saved = api(config, '/dns_records/' + config['record_id'], 'PUT', desired)['result']
        if not matches(saved, desired):
            raise RuntimeError('dns_update_confirmation_mismatch')
    confirmed = api(config, '/dns_records/' + config['record_id'])['result']
    if not matches(confirmed, desired):
        raise RuntimeError('dns_readback_mismatch')
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Verify address and DNS without writing')
    args = parser.parse_args()
    if CONFIG.stat().st_mode & 0o077:
        raise RuntimeError('credential_file_permissions')
    config = json.loads(CONFIG.read_text())
    with open('/run/onecloud-ddns.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        attempt = timestamp()
        try:
            interface = config['interface']
            addresses = candidates(run_json(['ip', '-j', '-6', 'addr', 'show', 'dev', interface]), interface)
            if not addresses or len(addresses) > 8:
                raise RuntimeError('invalid_ipv6_candidate_count')
            verified = [address for address in addresses if probe(address)]
            routes = run_json(['ip', '-j', '-6', 'route', 'get', '2606:4700:4700::1111'])
            address = select_verified(addresses, verified, routes, interface)
            if args.check:
                record = api(config, '/dns_records/' + config['record_id'])['result']
                desired = {'name': config['name'], 'content': address, 'ttl': config['ttl']}
                if not matches(record, desired):
                    raise RuntimeError('dns_check_mismatch')
                status = 'check_ok'
            else:
                status = 'updated' if update(config, address) else 'unchanged'
            observation = {'status': status, 'name': config['name'], 'ipv6': address,
                           'ttl': config['ttl'], 'proxied': False, 'lastAttemptAt': attempt,
                           'lastSuccessAt': timestamp()}
            persist_status(observation)
            print(json.dumps(observation))
        except Exception as error:
            persist_status({**previous_status(), 'name': config['name'], 'status': 'error',
                            'lastAttemptAt': attempt, 'errorCode': safe_error(error)})
            raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Emit only a controlled error; config and HTTP headers stay out of logs.
        message = safe_error(error)
        print(json.dumps({'status': 'error', 'reason': message}), file=sys.stderr)
        sys.exit(1)
