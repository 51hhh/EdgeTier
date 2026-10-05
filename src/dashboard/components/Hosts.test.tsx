import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HostSnapshot } from '../../observer/host-types';
import { mergeHostSnapshots } from '../host-display';
import { createTranslator } from '../i18n';
import { DdnsDashboard, HostServices } from './Hosts';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const t = createTranslator('en');
function host(id = 'onecloud'): HostSnapshot {
  return { profile: { hostId: id, displayName: id, roomId: 'home', networkName: 'mesh', directHostname: 'ip.example.org', directPort: 11010 },
    freshness: 'fresh', receivedAt: new Date(NOW).toISOString(), ddnsHistory: [],
    report: { schemaVersion: 1, hostId: id, reportId: 'report', bootId: 'boot', sequence: 1, capturedAt: new Date(NOW).toISOString(), collectorVersion: '1',
      ddns: { name: 'ip.example.org', status: 'check_ok', ipv6: '2001:db8::1' },
      services: [{ unit: 'easytier-core-home.service', activeState: 'active', subState: 'running', enabled: false, unitFileState: 'static' }],
      easytier: { status: 'error', peers: [] } } };
}
function ddns(hosts: HostSnapshot[]) { return renderToStaticMarkup(<DdnsDashboard hosts={hosts} now={NOW} t={t} requesting={{}} refreshErrors={{}} onRefresh={() => {}} />); }

describe('host availability and service display', () => {
  it('preserves failed host observations but disables its control while another host remains usable', () => {
    const first = host();
    const failed: HostSnapshot = { profile: first.profile, freshness: 'never', ddnsHistory: [], readErrorCode: 'host_state_unavailable' };
    const merged = mergeHostSnapshots([first], [failed, host('healthy')]);
    const html = ddns(merged);
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(buttons[1]).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(html).toContain(t('hosts.unavailable'));
    expect(html).toContain(t('hosts.readUnavailable'));
    expect(html).toContain('2001:db8::1');
    expect(html.match(new RegExp(t('hosts.fresh'), 'g'))).toHaveLength(1);
  });
  it('does not classify an unreadable first snapshot as a host that has never reported', () => {
    const unreadable: HostSnapshot = { profile: host().profile, freshness: 'never', ddnsHistory: [], readErrorCode: 'host_state_unavailable' };
    const html = ddns([unreadable]);
    expect(html).toContain(t('hosts.unavailable'));
    expect(html).not.toContain(t('hosts.neverTitle'));
    expect(html).not.toContain(t('hosts.never'));
    expect(html).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/);
  });
  it('shows truthful permanent enablement and raw unit-file state', () => {
    const html = renderToStaticMarkup(<HostServices hosts={[host()]} now={NOW} t={t} />);
    expect(html).toContain(t('services.enabled'));
    expect(html).toContain('<code>static</code>');
    expect(html).toContain(t('services.no'));
    expect(html).not.toContain('Starts on boot');
  });
  it('shows omitted counts and does not present a truncated empty list as no mesh peers', () => {
    const report = host();
    report.report!.easytier.truncated = true;
    report.report!.easytier.omittedPeers = 8;
    const html = renderToStaticMarkup(<HostServices hosts={[report]} now={NOW} t={t} />);
    expect(html).toContain(t('services.truncated'));
    expect(html).toContain(t('services.omittedPeers', { shown: 0, omitted: 8 }));
    expect(html).not.toContain(t('services.noPeers'));
  });
  it('can signal only connection-detail reduction without inventing omitted peer counts', () => {
    const report = host();
    report.report!.easytier.truncated = true;
    report.report!.easytier.peers = [{ peerId: 42, hostname: 'mesh-node', proxyCidrs: [], connections: [] }];
    const html = renderToStaticMarkup(<HostServices hosts={[report]} now={NOW} t={t} />);
    expect(html).toContain(t('services.truncated'));
    expect(html).toContain('mesh-node');
    expect(html).not.toContain('additional peers were omitted');
  });
});
