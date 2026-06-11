import { describe, expect, it } from 'vitest';
import { buildEasyTierConfig, defaultConfigOptions, PUBLIC_TCP_PEER, PUBLIC_UDP_PEER } from './easytier-config';

describe('buildEasyTierConfig', () => {
  it('renders identity, secret, and selected flags', () => {
    const toml = buildEasyTierConfig({
      ...defaultConfigOptions('home-mesh'),
      instanceName: 'laptop',
      networkSecret: 'super-secret',
    });

    expect(toml).toContain('instance_name = "laptop"');
    expect(toml).toContain('network_name = "home-mesh"');
    expect(toml).toContain('network_secret = "super-secret"');
    expect(toml).toContain('latency_first = true');
    expect(toml).toContain('private_mode = true');
    expect(toml).toContain('no_listener = true');
    expect(toml.endsWith('\n')).toBe(true);
  });

  it('includes the EdgeTier WSS peer and toggled public peers', () => {
    const toml = buildEasyTierConfig({
      ...defaultConfigOptions('home-mesh'),
      networkSecret: 's',
      edgePeerUri: 'wss://edge.example/ws?room=home-mesh&token=abc',
      includePublicUdpPeer: true,
      includePublicTcpPeer: false,
    });

    expect(toml).toContain('uri = "wss://edge.example/ws?room=home-mesh&token=abc"');
    expect(toml).toContain(`uri = "${PUBLIC_UDP_PEER}"`);
    expect(toml).not.toContain(`uri = "${PUBLIC_TCP_PEER}"`);
  });

  it('omits peers when none are selected', () => {
    const toml = buildEasyTierConfig({
      ...defaultConfigOptions('home-mesh'),
      networkSecret: 's',
      edgePeerUri: undefined,
      includePublicUdpPeer: false,
      includePublicTcpPeer: false,
    });

    expect(toml).not.toContain('[[peer]]');
  });

  it('rejects values that would break TOML string quoting', () => {
    expect(() => buildEasyTierConfig({
      ...defaultConfigOptions('home-mesh'),
      networkSecret: 'bad"injection',
    })).toThrow();
    expect(() => buildEasyTierConfig({
      ...defaultConfigOptions('home"mesh'),
      networkSecret: 's',
    })).toThrow();
  });
});
