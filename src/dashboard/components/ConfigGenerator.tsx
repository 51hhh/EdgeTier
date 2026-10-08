import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Code, Empty, Input, LayerCard, Select, SensitiveInput, Switch, Text } from '@cloudflare/kumo';
import { createRoomRelayToken } from '../api';
import { downloadConfig } from '../config-download';
import { createSelectionGuard } from '../room-state';
import { buildEasyTierConfig, ConfigValidationError, defaultConfigOptions, directProfileAvailable, directProfileVerified,
  EASYTIER_FLAG_ORDER, type ConfigRelayPeer, type EasyTierConfigOptions, type EasyTierFlag } from '../easytier-config';
import type { ConfigProfile } from '../../observer/host-types';
import type { I18nKey, Translator } from '../i18n';

const FLAG_LABEL_KEYS: Record<EasyTierFlag, I18nKey> = {
  latency_first: 'config.flag.latency_first', private_mode: 'config.flag.private_mode',
  enable_exit_node: 'config.flag.enable_exit_node', no_tun: 'config.flag.no_tun', use_smoltcp: 'config.flag.use_smoltcp',
  disable_ipv6: 'config.flag.disable_ipv6', enable_kcp_proxy: 'config.flag.enable_kcp_proxy',
  enable_quic_proxy: 'config.flag.enable_quic_proxy', disable_p2p: 'config.flag.disable_p2p',
  p2p_only: 'config.flag.p2p_only', multi_thread: 'config.flag.multi_thread', accept_dns: 'config.flag.accept_dns',
};

export function ConfigGenerator({ profiles, t }: { profiles: ConfigProfile[]; t: Translator }) {
  const [selected, setSelected] = useState('');
  const profile = profiles.find((item) => item.hostId === selected) ?? profiles[0];
  const identity = profile ? `${profile.hostId}:${profile.roomId}:${profile.networkName}` : '';
  const identityRequests = useRef(createSelectionGuard());
  identityRequests.current.select(identity);
  const [options, setOptions] = useState<EasyTierConfigOptions>(() => defaultConfigOptions());
  const [edgePeer, setEdgePeer] = useState<ConfigRelayPeer | undefined>();
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'copying' | 'copied' | 'error' | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setOptions(defaultConfigOptions(profile?.networkName));
    setEdgePeer(undefined);
    setTokenError(null);
    setIssuing(false);
  }, [identity]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    identityRequests.current.select(identity);
    return () => identityRequests.current.select(null);
  }, [identity]);

  const update = (patch: Partial<EasyTierConfigOptions>) => setOptions((prev) => ({ ...prev, ...patch }));
  const toggleFlag = (flag: EasyTierFlag) => setOptions((prev) => ({ ...prev, flags: { ...prev.flags, [flag]: !prev.flags[flag] } }));
  const generated = useMemo(() => {
    try { return { toml: buildEasyTierConfig({ ...options, profile, edgePeer }, now), error: null }; }
    catch (err) { return { toml: '', error: err instanceof ConfigValidationError ? t(`config.validation.${err.code}`) : t('errors.buildConfig') }; }
  }, [options, profile, edgePeer, now, t]);

  const latestToml = useRef(generated.toml);
  latestToml.current = generated.toml;
  useEffect(() => { setCopyStatus(null); }, [generated.toml]);

  const issueEdgeToken = async () => {
    if (!profile) return;
    const ticket = identityRequests.current.capture();
    setIssuing(true);
    try {
      const token = await createRoomRelayToken(profile.roomId);
      if (!identityRequests.current.isCurrent(ticket)) return;
      if (token.room !== profile.roomId) throw new Error(t('config.validation.tokenMismatch'));
      setEdgePeer({ uri: `${window.location.origin.replace(/^http/, 'ws')}${token.uriPath}`,
        roomId: token.room, networkName: profile.networkName, expiresAt: token.expiresAt });
      setTokenError(null);
      setNow(Date.now());
    } catch (err) {
      if (identityRequests.current.isCurrent(ticket)) setTokenError(err instanceof Error ? err.message : t('errors.issueToken'));
    } finally { if (identityRequests.current.isCurrent(ticket)) setIssuing(false); }
  };

  const currentConfig = (): string | null => {
    // Revalidate each export gesture: a rendered credential may just have expired.
    try { return buildEasyTierConfig({ ...options, profile, edgePeer }, Date.now()); }
    catch { setNow(Date.now()); return null; }
  };

  const download = () => {
    const toml = currentConfig();
    if (!toml) return;
    downloadConfig(toml, `easytier-${(options.networkName || 'mesh').replace(/[^a-zA-Z0-9._-]/g, '_')}.toml`);
  };

  const copyConfig = async () => {
    const toml = currentConfig();
    if (!toml) return;
    const ticket = identityRequests.current.capture();
    setCopyStatus('copying');
    try {
      await navigator.clipboard.writeText(toml);
      if (identityRequests.current.isCurrent(ticket) && latestToml.current === toml) setCopyStatus('copied');
    } catch {
      if (identityRequests.current.isCurrent(ticket) && latestToml.current === toml) setCopyStatus('error');
    }
  };

  if (!profile) return <Empty title={t('config.noProfiles')} description={t('config.noProfilesHelp')} />;
  const directReady = directProfileAvailable(profile, now);
  const directVerified = directProfileVerified(profile, now);
  const expired = edgePeer && Date.parse(edgePeer.expiresAt) <= now;

  return <div className="stack">
    <LayerCard>
      <LayerCard.Secondary>{t('config.profile')} <Badge variant="outline">{t('hosts.ipv6Only')}</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="stack compact">
          <Select label={t('config.profile')} hideLabel={false} value={profile.hostId} onValueChange={(value) => { if (value) setSelected(value); }}>
            {profiles.map((item) => <Select.Option key={item.hostId} value={item.hostId}>{item.displayName} · {item.networkName}</Select.Option>)}
          </Select>
          <Text as="p" variant="secondary">{t('hosts.roomNetwork', { room: profile.roomId, network: profile.networkName })}</Text>
          <Text as="p" variant="secondary" size="sm">{t('config.profileHelp')}</Text>
          {profile.readErrorCode && <Text as="p" variant="error" role="alert">{t('hosts.readUnavailable')}</Text>}
        </div>
      </LayerCard.Primary>
    </LayerCard>
    <LayerCard>
      <LayerCard.Secondary>{t('config.identity')}</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="form-grid">
          <Input label={t('config.instanceName')} value={options.instanceName} onChange={(e) => update({ instanceName: e.target.value })} />
          <Input label={t('config.networkName')} value={profile.networkName} readOnly />
          <SensitiveInput label={t('config.networkSecret')} value={options.networkSecret} onChange={(e) => update({ networkSecret: (e.target as HTMLInputElement).value })} placeholder={t('config.placeholderSecret')} />
          <Input label={t('config.hostnameOptional')} value={options.hostname ?? ''} onChange={(e) => update({ hostname: e.target.value })} />
          {!options.dhcp && <Input label={t('config.staticIpv4')} value={options.staticIpv4} onChange={(e) => update({ staticIpv4: e.target.value })} placeholder="10.144.1.20/24" />}
        </div>
        <div className="switch-row">
          <Switch label={t('config.dhcp')} checked={options.dhcp} onClick={() => update({ dhcp: !options.dhcp })} />
          <Switch label={t('config.noListener')} checked={options.noListener} onClick={() => update({ noListener: !options.noListener })} />
        </div>
        {!options.dhcp && <Text as="p" variant="secondary" size="sm">{t('config.staticHelp')}</Text>}
        <Text as="p" variant="secondary" size="sm">{t('config.secretHelp')}</Text>
      </LayerCard.Primary>
    </LayerCard>
    <LayerCard>
      <LayerCard.Secondary>{t('config.publicPeers')} <Badge variant={directVerified ? 'primary' : 'secondary'}>{profile.directHostname}</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="stack compact">
          <Text as="p" variant="secondary">{t('config.directHelp')}</Text>
          {!directReady && <Text as="p" variant="error" role="status">{t('config.directUnavailable')}</Text>}
          {directReady && !directVerified && <Text as="p" variant="secondary" role="status">{t('config.directUnverified')}</Text>}
          {profile.verifiedAt && <Text as="p" variant="secondary" size="sm">{t('config.verifiedAt', { time: profile.verifiedAt })}</Text>}
          {directReady && <div className="host-endpoints">{profile.directPeers.map((uri) => <code key={uri}>{uri}</code>)}</div>}
        </div>
        <div className="switch-row">
          <Switch label={t('config.includeUdp')} checked={options.includePublicUdpPeer} onClick={() => update({ includePublicUdpPeer: !options.includePublicUdpPeer })} />
          <Switch label={t('config.includeTcp')} checked={options.includePublicTcpPeer} onClick={() => update({ includePublicTcpPeer: !options.includePublicTcpPeer })} />
        </div>
      </LayerCard.Primary>
    </LayerCard>
    <LayerCard>
      <LayerCard.Secondary>{t('config.edgePeer')} <Badge variant="outline">{t('devices.shortLived')}</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="stack compact">
          <Text as="p" variant="secondary">{t('config.edgeTemporaryHelp')}</Text>
          <div className="switch-row">
            <Button type="button" variant="outline" onClick={issueEdgeToken} disabled={issuing}>{t('config.issueEdgePeer', { room: profile.roomId })}</Button>
            {edgePeer && <Button type="button" variant="ghost" onClick={() => setEdgePeer(undefined)}>{t('config.removeEdge')}</Button>}
          </div>
          {tokenError && <Text as="p" variant="error" role="alert">{tokenError}</Text>}
          {edgePeer && <Text as="p" variant={expired ? 'error' : 'secondary'} size="sm">{expired ? t('config.tokenExpired') : t('config.edgePeerAdded', { expiresAt: edgePeer.expiresAt })}</Text>}
        </div>
      </LayerCard.Primary>
    </LayerCard>
    <LayerCard>
      <LayerCard.Secondary>{t('config.flags')}</LayerCard.Secondary>
      <LayerCard.Primary><div className="flag-grid">
        {EASYTIER_FLAG_ORDER.map((flag) => <Switch key={flag} label={t(FLAG_LABEL_KEYS[flag])} checked={Boolean(options.flags[flag])} onClick={() => toggleFlag(flag)} />)}
      </div></LayerCard.Primary>
    </LayerCard>
    <LayerCard>
      <LayerCard.Secondary>{t('config.generated')} <Badge variant="error">{t('config.containsSecret')}</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        {generated.error && <Text as="p" variant="error" role="status">{generated.error}</Text>}
        {generated.toml && <Code lang="bash" code={generated.toml} />}
        <div className="switch-row">
          <Button type="button" variant="primary" onClick={download} disabled={!generated.toml}>{t('config.download')}</Button>
          <Button type="button" variant="outline" onClick={copyConfig} disabled={!generated.toml || copyStatus === 'copying'}>{t(copyStatus === 'copying' ? 'config.copying' : 'config.copy')}</Button>
        </div>
        {copyStatus === 'copied' && <Text as="p" variant="secondary" size="sm" role="status">{t('config.copied')}</Text>}
        {copyStatus === 'error' && <Text as="p" variant="error" size="sm" role="alert">{t('config.copyError')}</Text>}
        <Text as="p" variant="secondary" size="sm">{t('config.fileSecretHelp')}</Text>
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}
