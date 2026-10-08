import { describe, expect, it } from 'vitest';
import { appendDdnsHistory, DDNS_HISTORY_LIMIT, rememberDdnsAddress, restoreDdnsHistory } from './ddns-history';
import type { DdnsAddressHistoryEntry, DdnsHistoryEntry, DdnsObservation } from './host-types';

const at = '2026-10-08T12:00:00Z';
const success = (ipv6 = '2409::1', lastSuccessAt = at): DdnsObservation => ({ name: 'ip.example.org',
  status: 'unchanged', ipv6, currentIpv6: ipv6, ttl: 120, proxied: false, lastSuccessAt });
const failure = (errorCode = 'ipv6_probe_failed'): DdnsObservation => ({ ...success(), status: 'error', errorCode });

describe('meaningful persisted DDNS history', () => {
  it('collapses 1000 consecutive failures without evicting preceding success and address changes', () => {
    let rows = appendDdnsHistory([], success('2409::a'), at);
    rows = appendDdnsHistory(rows, success('2409::b'), at);
    for (let i = 0; i < 1000; i++) rows = appendDdnsHistory(rows, { ...failure(), ipv6: '2409::b', currentIpv6: '2409::b' }, new Date(Date.parse(at) + i * 60_000).toISOString());
    expect(rows).toHaveLength(3);
    expect(rows[0].observation.ipv6).toBe('2409::a');
    expect(rows[1].observation.status).toBe('unchanged');
    expect(rows[2].count).toBe(1000);
    expect(rows[2].firstReceivedAt).toBe(new Date(Date.parse(at)).toISOString());
    expect(rows[2].receivedAt).not.toBe(rows[2].firstReceivedAt);
  });
  it('groups successful check variants and canonical IPv6 spellings but keeps error/address transitions', () => {
    let rows = appendDdnsHistory([], { ...success(), status: 'updated' }, at);
    rows = appendDdnsHistory(rows, { ...success(), ipv6: '2409:0:0:0:0:0:0:1', status: 'check_ok' }, at);
    expect(rows).toHaveLength(1);
    rows = appendDdnsHistory(rows, failure(), at);
    rows = appendDdnsHistory(rows, failure('cloudflare_http_503'), at);
    rows = appendDdnsHistory(rows, { ...failure('cloudflare_http_503'), currentIpv6: '2409::2' }, at);
    expect(rows).toHaveLength(4);
  });
  it('converts old sliding windows and explicitly recovers only the retained successful checkpoint', () => {
    const current = failure();
    const old = Array.from({ length: 32 }, (_, i) => ({ receivedAt: new Date(Date.parse(at) + 60_000 + i * 60_000).toISOString(), observation: current }));
    const rows = restoreDdnsHistory(old, current);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ recovered: true, receivedAt: at, observation: { status: 'check_ok' } });
    expect(rows[1]).toMatchObject({ count: 32, observation: { status: 'error' } });
    expect(restoreDdnsHistory(rows, current)).toEqual(rows);
  });
  it('bounds state transitions while a separate ledger retains addresses across flapping failures', () => {
    let rows: DdnsHistoryEntry[] = [];
    let ledger: DdnsAddressHistoryEntry[] = [];
    for (const ip of ['2409::a', '2409::b']) {
      rows = appendDdnsHistory(rows, success(ip), at);
      ledger = rememberDdnsAddress(ledger, success(ip));
    }
    for (let i = 0; i < 100; i++) {
      const observation = { ...failure(`failure_${i}`), ipv6: '2409::b' };
      rows = appendDdnsHistory(rows, observation, at);
      ledger = rememberDdnsAddress(ledger, observation);
    }
    expect(rows).toHaveLength(DDNS_HISTORY_LIMIT);
    expect(ledger.map((entry) => entry.ipv6)).toEqual(['2409::a', '2409::b']);
    expect(ledger.every((entry) => entry.successCount === 1)).toBe(true);
  });
  it('counts unique retained successful confirmations, not heartbeats, and bounds unique addresses', () => {
    let ledger = rememberDdnsAddress([], success());
    for (let i = 0; i < 100; i++) ledger = rememberDdnsAddress(ledger, success());
    expect(ledger[0].successCount).toBe(1);
    ledger = rememberDdnsAddress(ledger, success('2409::1', '2026-10-08T12:02:00Z'));
    expect(ledger[0]).toMatchObject({ firstSuccessAt: at, lastSuccessAt: '2026-10-08T12:02:00Z', successCount: 2 });
    for (let i = 2; i < 25; i++) ledger = rememberDdnsAddress(ledger, success(`2409::${i.toString(16)}`, new Date(Date.parse(at) + i * 600_000).toISOString()));
    expect(ledger).toHaveLength(16);
    expect(ledger.at(-1)?.ipv6).toBe('2409::18');
  });
});
