import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Code, Input, LayerCard, SensitiveInput, Switch, Text } from '@cloudflare/kumo';
import { createRoomRelayToken } from '../api';
import {
  buildEasyTierConfig,
  defaultConfigOptions,
  EASYTIER_FLAG_ORDER,
  type EasyTierConfigOptions,
  type EasyTierFlag,
} from '../easytier-config';
import type { I18nKey, Translator } from '../i18n';

interface ConfigGeneratorProps {
  defaultNetworkName: string;
  t: Translator;
}

function wssOrigin(): string {
  return window.location.origin.replace(/^http/, 'ws');
}

const FLAG_LABEL_KEYS: Record<EasyTierFlag, I18nKey> = {
  latency_first: 'config.flag.latency_first',
  private_mode: 'config.flag.private_mode',
  enable_exit_node: 'config.flag.enable_exit_node',
  no_tun: 'config.flag.no_tun',
  use_smoltcp: 'config.flag.use_smoltcp',
  disable_ipv6: 'config.flag.disable_ipv6',
  enable_kcp_proxy: 'config.flag.enable_kcp_proxy',
  enable_quic_proxy: 'config.flag.enable_quic_proxy',
  disable_p2p: 'config.flag.disable_p2p',
  p2p_only: 'config.flag.p2p_only',
  multi_thread: 'config.flag.multi_thread',
  accept_dns: 'config.flag.accept_dns',
};

export function ConfigGenerator({ defaultNetworkName, t }: ConfigGeneratorProps) {
  const [options, setOptions] = useState<EasyTierConfigOptions>(() => defaultConfigOptions(defaultNetworkName));
  const [edgeToken, setEdgeToken] = useState<{ uri: string; expiresAt: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const update = (patch: Partial<EasyTierConfigOptions>) => setOptions((prev) => ({ ...prev, ...patch }));
  const toggleFlag = (flag: EasyTierFlag, checked: boolean) => setOptions((prev) => ({ ...prev, flags: { ...prev.flags, [flag]: checked } }));

  useEffect(() => {
    setOptions((prev) => {
      if (!defaultNetworkName || prev.networkName !== 'home-mesh' || prev.networkName === defaultNetworkName) return prev;
      return {
        ...prev,
        instanceName: `${defaultNetworkName}-client`,
        networkName: defaultNetworkName,
      };
    });
  }, [defaultNetworkName]);

  const edgePeerUri = edgeToken?.uri;

  const toml = useMemo(() => {
    try {
      const result = buildEasyTierConfig({ ...options, edgePeerUri });
      setBuildError(null);
      return result;
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : t('errors.buildConfig'));
      return '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, edgePeerUri, t]);

  const issueEdgeToken = async () => {
    try {
      const token = await createRoomRelayToken(options.networkName);
      setEdgeToken({ uri: `${wssOrigin()}${token.uriPath}`, expiresAt: token.expiresAt });
      setTokenError(null);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : t('errors.issueToken'));
    }
  };

  const download = () => {
    const blob = new Blob([toml], { type: 'application/toml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `easytier-${options.networkName || 'mesh'}.toml`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="stack">
    <LayerCard>
      <LayerCard.Secondary>{t('config.identity')}</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="form-grid">
          <Input label={t('config.instanceName')} value={options.instanceName} onChange={(e) => update({ instanceName: e.target.value })} placeholder={`${defaultNetworkName}-client`} />
          <Input label={t('config.networkName')} value={options.networkName} onChange={(e) => update({ networkName: e.target.value })} placeholder={defaultNetworkName} />
          <SensitiveInput label={t('config.networkSecret')} value={options.networkSecret} onChange={(e) => update({ networkSecret: (e.target as HTMLInputElement).value })} placeholder={t('config.placeholderSecret')} />
          <Input label={t('config.hostnameOptional')} value={options.hostname ?? ''} onChange={(e) => update({ hostname: e.target.value })} placeholder="" />
        </div>
        <div className="switch-row">
          <Switch label="DHCP" checked={options.dhcp} onClick={() => update({ dhcp: !options.dhcp })} />
          <Switch label={t('config.noListener')} checked={options.noListener} onClick={() => update({ noListener: !options.noListener })} />
        </div>
        <Text as="p" variant="secondary" size="sm">{t('config.secretHelp')}</Text>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>{t('config.edgePeer')} <Badge variant="outline">{t('devices.shortLived')}</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="stack">
          <Text as="p" variant="secondary">{t('config.edgePeerHelp')}</Text>
          <div>
            <Button type="button" variant="outline" onClick={issueEdgeToken}>{t('config.issueEdgePeer', { networkName: options.networkName })}</Button>
          </div>
          {tokenError && <Text as="p" variant="error" role="alert">{tokenError}</Text>}
          {edgeToken && <Text as="p" variant="secondary" size="sm">{t('config.edgePeerAdded', { expiresAt: edgeToken.expiresAt })}</Text>}
        </div>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>{t('config.publicPeers')}</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="switch-row">
          <Switch label={t('config.includeUdp')} checked={options.includePublicUdpPeer} onClick={() => update({ includePublicUdpPeer: !options.includePublicUdpPeer })} />
          <Switch label={t('config.includeTcp')} checked={options.includePublicTcpPeer} onClick={() => update({ includePublicTcpPeer: !options.includePublicTcpPeer })} />
        </div>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>{t('config.flags')}</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="flag-grid">
          {EASYTIER_FLAG_ORDER.map((flag) => (
            <Switch key={flag} label={t(FLAG_LABEL_KEYS[flag])} checked={Boolean(options.flags[flag])} onClick={() => toggleFlag(flag, !options.flags[flag])} />
          ))}
        </div>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>{t('config.generated')} <Badge variant="error">{t('config.containsSecret')}</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        {buildError && <Text as="p" variant="error" role="alert">{buildError}</Text>}
        <Code lang="bash" code={toml} />
        <div className="switch-row">
          <Button type="button" variant="primary" onClick={download} disabled={!toml || !options.networkSecret}>{t('config.download')}</Button>
        </div>
        <Text as="p" variant="secondary" size="sm">{t('config.fileSecretHelp')}</Text>
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}
