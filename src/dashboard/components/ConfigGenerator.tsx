import React, { useMemo, useState } from 'react';
import { Badge, Button, Code, Input, LayerCard, SensitiveInput, Switch, Text } from '@cloudflare/kumo';
import { createRoomRelayToken } from '../api';
import {
  buildEasyTierConfig,
  defaultConfigOptions,
  EASYTIER_FLAG_LABELS,
  EASYTIER_FLAG_ORDER,
  type EasyTierConfigOptions,
  type EasyTierFlag,
} from '../easytier-config';

function wssOrigin(): string {
  return window.location.origin.replace(/^http/, 'ws');
}

export function ConfigGenerator() {
  const [options, setOptions] = useState<EasyTierConfigOptions>(() => defaultConfigOptions('home-mesh'));
  const [edgeToken, setEdgeToken] = useState<{ uri: string; expiresAt: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const update = (patch: Partial<EasyTierConfigOptions>) => setOptions((prev) => ({ ...prev, ...patch }));
  const toggleFlag = (flag: EasyTierFlag, checked: boolean) => setOptions((prev) => ({ ...prev, flags: { ...prev.flags, [flag]: checked } }));

  const edgePeerUri = edgeToken?.uri;

  const toml = useMemo(() => {
    try {
      const result = buildEasyTierConfig({ ...options, edgePeerUri });
      setBuildError(null);
      return result;
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'failed to build config');
      return '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, edgePeerUri]);

  const issueEdgeToken = async () => {
    try {
      const token = await createRoomRelayToken(options.networkName);
      setEdgeToken({ uri: `${wssOrigin()}${token.uriPath}`, expiresAt: token.expiresAt });
      setTokenError(null);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'failed to issue relay token');
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
      <LayerCard.Secondary>Identity</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="form-grid">
          <Input label="Instance name" value={options.instanceName} onChange={(e) => update({ instanceName: e.target.value })} placeholder="home-mesh-client" />
          <Input label="Network name" value={options.networkName} onChange={(e) => update({ networkName: e.target.value })} placeholder="home-mesh" />
          <SensitiveInput label="Network secret (not uploaded by this form)" value={options.networkSecret} onChange={(e) => update({ networkSecret: (e.target as HTMLInputElement).value })} placeholder="paste your network_secret" />
          <Input label="Hostname (optional)" value={options.hostname ?? ''} onChange={(e) => update({ hostname: e.target.value })} placeholder="" />
        </div>
        <div className="switch-row">
          <Switch label="DHCP" checked={options.dhcp} onClick={() => update({ dhcp: !options.dhcp })} />
          <Switch label="no_listener (recommended for clients)" checked={options.noListener} onClick={() => update({ noListener: !options.noListener })} />
        </div>
        <Text as="p" variant="secondary" size="sm">This form does not upload the secret. Configure the deployed Worker with EASYTIER_NETWORKS, EASYTIER_NETWORK_SECRETS, or the matching EASYTIER_NETWORK_SECRET secret.</Text>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>EdgeTier relay peer <Badge variant="outline">short lived</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="stack">
          <Text as="p" variant="secondary">Issue a room-scoped WSS token so EasyTier nodes can reach this mesh through EdgeTier. The token is added to the generated config.</Text>
          <div>
            <Button type="button" variant="outline" onClick={issueEdgeToken}>Issue EdgeTier peer for "{options.networkName}"</Button>
          </div>
          {tokenError && <Text as="p" variant="error" role="alert">{tokenError}</Text>}
          {edgeToken && <Text as="p" variant="secondary" size="sm">EdgeTier peer added; token expires {edgeToken.expiresAt}.</Text>}
        </div>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>Public peers</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="switch-row">
          <Switch label="Include public UDP peer" checked={options.includePublicUdpPeer} onClick={() => update({ includePublicUdpPeer: !options.includePublicUdpPeer })} />
          <Switch label="Include public TCP peer" checked={options.includePublicTcpPeer} onClick={() => update({ includePublicTcpPeer: !options.includePublicTcpPeer })} />
        </div>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>Flags</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className="flag-grid">
          {EASYTIER_FLAG_ORDER.map((flag) => (
            <Switch key={flag} label={EASYTIER_FLAG_LABELS[flag]} checked={Boolean(options.flags[flag])} onClick={() => toggleFlag(flag, !options.flags[flag])} />
          ))}
        </div>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>Generated config <Badge variant="error">contains secret</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
        {buildError && <Text as="p" variant="error" role="alert">{buildError}</Text>}
        <Code lang="bash" code={toml} />
        <div className="switch-row">
          <Button type="button" variant="primary" onClick={download} disabled={!toml || !options.networkSecret}>Download .toml</Button>
        </div>
        <Text as="p" variant="secondary" size="sm">This file contains your network_secret and a tokenized WSS URI. Treat it as a secret and do not commit it.</Text>
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}
