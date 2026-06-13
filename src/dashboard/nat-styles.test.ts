import { describe, expect, it } from 'vitest';
import { natStyleFor, nodeColorForPeerId } from './nat-styles';

describe('NAT styles', () => {
  it('returns style for known NAT types', () => {
    expect(natStyleFor('OpenInternet')).toHaveProperty('icon', '🌐');
    expect(natStyleFor('OpenInternet')).toHaveProperty('shape', 'circle');
    expect(natStyleFor('Symmetric')).toHaveProperty('shape', 'diamond');
    expect(natStyleFor('PortRestricted')).toHaveProperty('icon', '🟠');
    expect(natStyleFor('PortRestricted')).toHaveProperty('shape', 'square');
  });

  it('falls back to Unknown style for null or undefined NAT', () => {
    const unknownStyle = natStyleFor(null, null);
    expect(unknownStyle).toHaveProperty('shape', 'circle');
    expect(unknownStyle).toHaveProperty('icon', '❓');
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
});
