import React from 'react';
import { Badge, Button, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { HostPeer, HostService, HostSnapshot } from '../../observer/host-types';
import { successfulDdns } from '../../observer/ddns-history';
import { formatBytes, formatPercent } from '../format';
import { commandPending, observedFreshness, reportAgeSeconds } from '../host-display';
import type { I18nKey, Translator } from '../i18n';

interface HostsProps { hosts: HostSnapshot[]; now: number; t: Translator }
interface DdnsProps extends HostsProps {
  requesting: Record<string, boolean>;
  refreshErrors: Record<string, string>;
  onRefresh: (hostId: string) => void;
}

const SERVICE_LABELS: Record<string, I18nKey> = {
  'easytier-core-home.service': 'services.core', 'easytier-web.service': 'services.web',
  'edgetier-home-cloudflared.service': 'services.tunnel', 'onecloud-ddns.timer': 'services.ddnsTimer',
  'onecloud-ddns.service': 'services.ddnsJob', 'edgetier-host.timer': 'services.reportTimer',
  'edgetier-host.service': 'services.reportJob',
};
const DDNS_ERROR_LABELS: Record<string, I18nKey> = {
  ipv6_probe_failed: 'ddns.probeFailed', no_unambiguous_verified_ipv6: 'ddns.probeFailed',
  ambiguous_verified_ipv6: 'ddns.ambiguousAddress',
};

function HostHeading({ host, now, t }: { host: HostSnapshot; now: number; t: Translator }) {
  const freshness = observedFreshness(host, now);
  const age = reportAgeSeconds(host, now);
  return <div className="host-heading">
    <div className="stack compact">
      <Text as="h2" variant="heading3">{host.profile.displayName}</Text>
      <Text as="p" variant="secondary" size="sm">{t('hosts.roomNetwork', { room: host.profile.roomId, network: host.profile.networkName })}</Text>
    </div>
    <div className="hero-meta">
      <Badge variant={!host.readErrorCode && freshness === 'fresh' ? 'primary' : 'secondary'}>{t(host.readErrorCode ? 'hosts.unavailable' : `hosts.${freshness}`)}</Badge>
      {age !== undefined && <Badge variant="outline">{t('hosts.age', { seconds: age })}</Badge>}
    </div>
  </div>;
}

function HostTimes({ host, now, t }: { host: HostSnapshot; now: number; t: Translator }) {
  return <div className="stack compact">
    {host.readErrorCode && <Text as="p" variant="error" role="alert">{t('hosts.readUnavailable')}</Text>}
    {observedFreshness(host, now) === 'stale' && <Text as="p" variant="error" role="status">{t('hosts.lastKnown')}</Text>}
    <dl className="host-details">
      <Detail label={t('hosts.received')} value={host.receivedAt} t={t} />
      <Detail label={t('hosts.captured')} value={host.report?.capturedAt} t={t} />
    </dl>
  </div>;
}

function Detail({ label, value, t }: { label: string; value?: React.ReactNode; t: Translator }) {
  return <div><dt>{label}</dt><dd>{value ?? t('common.notObserved')}</dd></div>;
}

export function DdnsDashboard({ hosts, now, t, requesting, refreshErrors, onRefresh }: DdnsProps) {
  if (!hosts.length) return <Empty title={t('hosts.emptyTitle')} description={t('hosts.emptyHelp')} />;
  return <div className="stack">{hosts.map((host) => {
    const ddns = host.report?.ddns;
    const command = host.command;
    const pending = commandPending(command, now);
    const commandStatus = command?.status === 'pending' && !pending ? 'expired' : command?.status;
    return <LayerCard key={host.profile.hostId}>
      <LayerCard.Secondary><HostHeading host={host} now={now} t={t} /></LayerCard.Secondary>
      <LayerCard.Primary><div className="stack">
        <HostTimes host={host} now={now} t={t} />
        {!ddns ? <Empty title={t(host.readErrorCode ? 'hosts.unavailable' : 'hosts.neverTitle')} description={host.readErrorCode ? undefined : t('hosts.neverHelp')} /> : <>
          <div className="hero-meta">
            <Badge variant={ddns.status === 'error' ? 'error' : ddns.status === 'unknown' ? 'secondary' : 'primary'}>{t(`ddns.${ddns.status}`)}</Badge>
            <Badge variant="outline">AAAA · {t('hosts.ipv6Only')}</Badge>
          </div>
          <dl className="host-details">
            <Detail label={t('ddns.record')} value={ddns.name} t={t} />
            <Detail label={t('ddns.currentIpv6')} value={ddns.currentIpv6 ? <code>{ddns.currentIpv6}</code> : undefined} t={t} />
            <Detail label={t('ddns.confirmedIpv6')} value={ddns.ipv6 ? <code>{ddns.ipv6}</code> : undefined} t={t} />
            <Detail label={t('ddns.ttl')} value={ddns.ttl === undefined ? undefined : `${ddns.ttl}s`} t={t} />
            <Detail label={t('ddns.proxy')} value={ddns.proxied === undefined ? undefined : t(ddns.proxied ? 'ddns.proxyOn' : 'ddns.proxyOff')} t={t} />
            <Detail label={t('ddns.lastAttempt')} value={ddns.lastAttemptAt} t={t} />
            <Detail label={t('ddns.lastSuccess')} value={ddns.lastSuccessAt} t={t} />
            {ddns.errorCode && <Detail label={t('ddns.errorCode')} value={<code>{ddns.errorCode}</code>} t={t} />}
          </dl>
          {ddns.errorCode && DDNS_ERROR_LABELS[ddns.errorCode] && <Text as="p" variant="secondary">{t(DDNS_ERROR_LABELS[ddns.errorCode])}</Text>}
        </>}
        <div className="stack compact">
          <div><Button type="button" variant="outline" onClick={() => onRefresh(host.profile.hostId)} disabled={Boolean(requesting[host.profile.hostId]) || pending || Boolean(host.readErrorCode)}>{t(requesting[host.profile.hostId] ? 'ddns.requesting' : 'ddns.refresh')}</Button></div>
          <Text as="p" variant="secondary" size="sm">{t('ddns.refreshHelp')}</Text>
          {refreshErrors[host.profile.hostId] && <Text as="p" variant="error" role="alert">{refreshErrors[host.profile.hostId]}</Text>}
          {command && commandStatus && <div className="host-command" role="status">
            <div className="hero-meta"><Text as="span">{t('ddns.command')}</Text><Badge variant={commandStatus === 'failed' || commandStatus === 'expired' ? 'error' : 'outline'}>{t(`ddns.${commandStatus}`)}</Badge></div>
            <dl className="host-details">
              <Detail label={t('ddns.requestedAt')} value={command.requestedAt} t={t} />
              <Detail label={t('ddns.expiresAt')} value={command.expiresAt} t={t} />
              {command.completedAt && <Detail label={t('ddns.completedAt')} value={command.completedAt} t={t} />}
              {command.errorCode && <Detail label={t('ddns.errorCode')} value={<code>{command.errorCode}</code>} t={t} />}
            </dl>
          </div>}
        </div>
        <div className="stack compact">
          <Text as="h3" variant="heading3">{t('ddns.history')}</Text>
          <Text as="p" variant="secondary" size="sm">{t('ddns.historyHelp')}</Text>
          {!host.ddnsHistory.length ? <Text as="p" variant="secondary">{t('ddns.historyEmpty')}</Text> : <div className="host-table-scroll"><Table>
            <Table.Header><Table.Row><Table.Head>{t('ddns.observedRange')}</Table.Head><Table.Head>{t('common.status')}</Table.Head><Table.Head>{t('ddns.confirmedIpv6')}</Table.Head><Table.Head>{t('ddns.errorCode')}</Table.Head><Table.Head>{t('ddns.observationCount')}</Table.Head></Table.Row></Table.Header>
            <Table.Body>{host.ddnsHistory.slice().reverse().map((item, index) => <Table.Row key={`${item.receivedAt}-${index}`}>
              <Table.Cell><div className="stack compact"><span>{item.firstReceivedAt ?? item.receivedAt}</span>{item.firstReceivedAt && item.firstReceivedAt !== item.receivedAt && <span>→ {item.receivedAt}</span>}{item.recovered && <small>{t('ddns.historyRecovered')}</small>}</div></Table.Cell><Table.Cell>{t(successfulDdns(item.observation) ? 'ddns.historySuccess' : `ddns.${item.observation.status}`)}</Table.Cell>
              <Table.Cell>{item.observation.ipv6 ?? t('common.notObserved')}</Table.Cell><Table.Cell>{item.observation.errorCode ?? '—'}</Table.Cell>
              <Table.Cell>{item.count ?? 1}</Table.Cell>
            </Table.Row>)}</Table.Body>
          </Table></div>}
        </div>
        <div className="stack compact">
          <Text as="h3" variant="heading3">{t('ddns.addressHistory')}</Text>
          <Text as="p" variant="secondary" size="sm">{t('ddns.addressHistoryHelp')}</Text>
          {!host.ddnsAddressHistory?.length ? <Text as="p" variant="secondary">{t('ddns.historyEmpty')}</Text> : <div className="host-table-scroll"><Table>
            <Table.Header><Table.Row><Table.Head>IPv6</Table.Head><Table.Head>{t('ddns.firstSuccess')}</Table.Head><Table.Head>{t('ddns.lastSuccess')}</Table.Head><Table.Head>{t('ddns.successCount')}</Table.Head></Table.Row></Table.Header>
            <Table.Body>{host.ddnsAddressHistory.slice().reverse().map((item) => <Table.Row key={item.ipv6}>
              <Table.Cell><code>{item.ipv6}</code></Table.Cell><Table.Cell>{item.firstSuccessAt}</Table.Cell><Table.Cell>{item.lastSuccessAt}</Table.Cell><Table.Cell>{item.successCount}</Table.Cell>
            </Table.Row>)}</Table.Body>
          </Table></div>}
        </div>
      </div></LayerCard.Primary>
    </LayerCard>;
  })}</div>;
}

export function HostServices({ hosts, now, t }: HostsProps) {
  if (!hosts.length) return <Empty title={t('hosts.emptyTitle')} description={t('hosts.emptyHelp')} />;
  return <div className="stack">{hosts.map((host) => {
    const report = host.report;
    return <LayerCard key={host.profile.hostId}>
      <LayerCard.Secondary><HostHeading host={host} now={now} t={t} /></LayerCard.Secondary>
      <LayerCard.Primary><div className="stack">
        <HostTimes host={host} now={now} t={t} />
        {!report ? <Empty title={t(host.readErrorCode ? 'hosts.unavailable' : 'hosts.neverTitle')} description={host.readErrorCode ? undefined : t('hosts.neverHelp')} /> : <>
          <Text as="h3" variant="heading3">{t('services.title')}</Text>
          <ServiceTable services={report.services} t={t} />
          <Text as="p" variant="secondary" size="sm">{t('services.provenance')}</Text>
          <div className="hero-meta"><Badge variant={report.easytier.status === 'ok' ? 'primary' : 'error'}>{t(report.easytier.status === 'ok' ? 'services.rpcOk' : 'services.rpcError')}</Badge>
            {report.easytier.errorCode && <code>{report.easytier.errorCode}</code>}
          </div>
          {report.easytier.node && <div className="stack compact">
            <Text as="h3" variant="heading3">{t('services.node')}</Text>
            <dl className="host-details">
              <Detail label={t('devices.peerId')} value={report.easytier.node.peerId} t={t} />
              <Detail label={t('common.hostname')} value={report.easytier.node.hostname} t={t} />
              <Detail label={t('common.version')} value={report.easytier.node.version} t={t} />
              <Detail label={t('devices.virtualIpv4')} value={report.easytier.node.virtualIpv4} t={t} />
              <Detail label={t('devices.virtualIpv6')} value={report.easytier.node.virtualIpv6} t={t} />
              <Detail label={t('devices.proxyCidrs')} value={report.easytier.node.proxyCidrs.length ? report.easytier.node.proxyCidrs.join(', ') : undefined} t={t} />
              <Detail label={t('services.listeners')} value={report.easytier.node.listeners.length ? <div className="host-endpoints">{report.easytier.node.listeners.map((uri) => <code key={uri}>{uri}</code>)}</div> : undefined} t={t} />
            </dl>
          </div>}
          <Text as="h3" variant="heading3">{t('services.peers')} <Badge variant="outline">{report.easytier.peers.length}</Badge></Text>
          {report.easytier.truncated && <Text as="p" variant="secondary" role="status">{t('services.truncated')}</Text>}
          {report.easytier.omittedPeers !== undefined && <Text as="p" variant="secondary" role="status">{t('services.omittedPeers', { shown: report.easytier.peers.length, omitted: report.easytier.omittedPeers })}</Text>}
          {(report.easytier.peers.length > 0 || !report.easytier.truncated) && <HostPeerTable peers={report.easytier.peers} t={t} />}
        </>}
      </div></LayerCard.Primary>
    </LayerCard>;
  })}</div>;
}

function ServiceTable({ services, t }: { services: HostService[]; t: Translator }) {
  if (!services.length) return <Text as="p" variant="secondary">{t('services.noServices')}</Text>;
  return <div className="host-table-scroll"><Table>
    <Table.Header><Table.Row><Table.Head>{t('services.unit')}</Table.Head><Table.Head>{t('services.activeState')}</Table.Head><Table.Head>{t('services.subState')}</Table.Head><Table.Head>{t('services.enabled')}</Table.Head><Table.Head>{t('services.unitFileState')}</Table.Head><Table.Head>{t('services.lastResult')}</Table.Head></Table.Row></Table.Header>
    <Table.Body>{services.map((service) => <Table.Row key={service.unit}>
      <Table.Cell><div className="stack compact"><span>{SERVICE_LABELS[service.unit] ? t(SERVICE_LABELS[service.unit]) : service.unit}</span><code>{service.unit}</code></div></Table.Cell>
      <Table.Cell><Badge variant={service.activeState === 'active' ? 'primary' : service.activeState === 'failed' ? 'error' : 'secondary'}>{service.activeState}</Badge></Table.Cell>
      <Table.Cell>{service.subState}</Table.Cell><Table.Cell>{t(service.enabled ? 'services.yes' : 'services.no')}</Table.Cell>
      <Table.Cell>{service.unitFileState ? <code>{service.unitFileState}</code> : t('common.notObserved')}</Table.Cell>
      <Table.Cell><div className="stack compact">{service.result && <Badge variant={service.result === 'success' && (!service.exitCode || service.exitCode === 0) ? 'primary' : 'error'}>{service.result}</Badge>}{service.exitCode !== undefined && <small>{t('services.exitCode', { code: service.exitCode })}</small>}{!service.result && service.exitCode === undefined && t('common.notObserved')}</div></Table.Cell>
    </Table.Row>)}</Table.Body>
  </Table></div>;
}

function HostPeerTable({ peers, t }: { peers: HostPeer[]; t: Translator }) {
  if (!peers.length) return <Text as="p" variant="secondary">{t('services.noPeers')}</Text>;
  return <div className="host-table-scroll"><Table>
    <Table.Header><Table.Row><Table.Head>{t('common.peer')}</Table.Head><Table.Head>{t('devices.virtualIpv4')}</Table.Head><Table.Head>{t('common.version')}</Table.Head><Table.Head>{t('common.nextHop')}</Table.Head><Table.Head>{t('services.connections')}</Table.Head></Table.Row></Table.Header>
    <Table.Body>{peers.map((peer) => <Table.Row key={peer.peerId}>
      <Table.Cell><div className="stack compact"><Badge variant="outline">{peer.peerId}</Badge><span>{peer.hostname ?? t('common.unknownPeer')}</span>{peer.proxyCidrs.length > 0 && <small>{peer.proxyCidrs.join(', ')}</small>}</div></Table.Cell>
      <Table.Cell>{peer.virtualIpv4 ?? t('common.notObserved')}</Table.Cell><Table.Cell>{peer.version ?? t('common.notObserved')}</Table.Cell>
      <Table.Cell>{peer.nextHopPeerId ?? t('common.notObserved')}</Table.Cell>
      <Table.Cell>{!peer.connections.length ? t('services.routeOnly') : <div className="stack compact">{peer.connections.map((connection, index) => <div className="host-connection" key={index}>
        <Badge variant="outline">{connection.transport}</Badge>
        {connection.remoteAddress && <code>{connection.remoteAddress}</code>}
        <span>{t('common.latency')}: {connection.latencyMs === undefined ? t('common.notObserved') : `${connection.latencyMs.toFixed(2)} ms`} · {t('common.lossRate')}: {connection.lossRate === undefined ? t('common.notObserved') : formatPercent(connection.lossRate)}</span>
        <span>{t('common.rx')}: {formatBytes(connection.rxBytes)} · {t('common.tx')}: {formatBytes(connection.txBytes)}</span>
      </div>)}</div>}</Table.Cell>
    </Table.Row>)}</Table.Body>
  </Table></div>;
}
