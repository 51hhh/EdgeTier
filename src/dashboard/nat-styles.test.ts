import { describe, expect, it } from 'vitest';
import { natStyleFor, nodeColorForPeerId } from './nat-styles';

describe('NAT styles', () => {
  it('returns style for known NAT types', () => {
    expect(natStyleFor('OpenInternet')).toHaveProperty('color');
    expect(natStyleFor('OpenInternet')).toHaveProperty('icon', '🌐');
    expect(natStyleFor('Symmetric')).toHaveProperty('strokeDasharray', '4 4');
    expect(natStyleFor('PortRestricted')).toHaveProperty('icon', '🟠');
  });

  it('falls back to Unknown style for null or undefined NAT', () => {
    const unknownStyle = natStyleFor(null, null);
    expect(unknownStyle).toHaveProperty('strokeDasharray', '2 2');
  });

  it('prefers UDP NAT type over TCP', () => {
    const udpStyle = natStyleFor('OpenInternet', 'Symmetric');
    expect(udpStyle.icon).toBe('🌐');
  });

  it('assigns deterministic colors based on peer ID', () => {
    const color1 = nodeColorForPeerId(123456);
    const color2 = nodeColorForPeerId(123456);
    expect(color1).toBe(color2);

    const color3 = nodeColorForPeerId(789012);
    expect(color3).toBeTruthy();
  });

  it('prefers NAT-based color when NAT type is known', () => {
    const natColor = nodeColorForPeerId(123456, 'OpenInternet');
    expect(natColor).toBeTruthy();
  });
});
