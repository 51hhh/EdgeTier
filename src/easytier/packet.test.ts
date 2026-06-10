import { describe, expect, it } from 'vitest';
import { EASYTIER_HEADER_SIZE, EasyTierPacketType } from './constants';
import { createEasyTierHeader, parseEasyTierHeader, payloadLengthMatches } from './packet';

describe('EasyTier packet header utilities', () => {
  it('round-trips the 16-byte little-endian EasyTier header', () => {
    const header = {
      fromPeerId: 0x01020304,
      toPeerId: 0x05060708,
      packetType: EasyTierPacketType.HandShake,
      flags: 1,
      forwardCounter: 2,
      reserved: 0,
      len: 4,
    };

    const encoded = createEasyTierHeader(header);

    expect(encoded.byteLength).toBe(EASYTIER_HEADER_SIZE);
    expect(parseEasyTierHeader(encoded)).toEqual(header);
  });

  it('validates declared payload length exactly', () => {
    const header = {
      fromPeerId: 1,
      toPeerId: 2,
      packetType: EasyTierPacketType.Data,
      flags: 0,
      forwardCounter: 0,
      reserved: 0,
      len: 3,
    };
    const frame = new Uint8Array(EASYTIER_HEADER_SIZE + 3);
    frame.set(new Uint8Array(createEasyTierHeader(header)), 0);

    expect(payloadLengthMatches(frame.buffer, header)).toBe(true);
    expect(payloadLengthMatches(frame.buffer.slice(0, EASYTIER_HEADER_SIZE + 2), header)).toBe(false);
    expect(payloadLengthMatches(new Uint8Array(EASYTIER_HEADER_SIZE + 4).buffer, header)).toBe(false);
  });
});
