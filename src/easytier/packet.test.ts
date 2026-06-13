import { describe, expect, it } from 'vitest';
import { EASYTIER_HEADER_SIZE, EasyTierPacketType } from './constants';
import { AEAD_TAIL_SIZE } from './crypto';
import { actualPayloadLength, createEasyTierFrame, createEasyTierHeader, parseEasyTierHeader, payloadLengthMatches, splitEasyTierFrames } from './packet';

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

  it('builds a complete frame with a matching payload length', () => {
    const payload = Uint8Array.of(9, 8, 7);
    const frame = createEasyTierFrame({
      fromPeerId: 1,
      toPeerId: 2,
      packetType: EasyTierPacketType.Pong,
      flags: 0,
      forwardCounter: 1,
      reserved: 0,
    }, payload);

    const header = parseEasyTierHeader(frame.buffer);
    expect(header?.len).toBe(payload.length);
    expect(new Uint8Array(frame.buffer, EASYTIER_HEADER_SIZE)).toEqual(payload);
  });

  it('supports encrypted frames whose header length excludes the AEAD tail', () => {
    const plaintextLength = 5;
    const encryptedPayload = new Uint8Array(plaintextLength + AEAD_TAIL_SIZE);
    const frame = createEasyTierFrame({
      fromPeerId: 1,
      toPeerId: 2,
      packetType: EasyTierPacketType.RpcReq,
      flags: 1,
      forwardCounter: 1,
      reserved: 0,
      len: plaintextLength,
    }, encryptedPayload);

    const header = parseEasyTierHeader(frame.buffer)!;
    expect(header.len).toBe(plaintextLength);
    expect(actualPayloadLength(header)).toBe(encryptedPayload.length);
    expect(payloadLengthMatches(frame.buffer, header)).toBe(true);
  });

  it('splits batched websocket messages into EasyTier frames', () => {
    const left = createEasyTierFrame({
      fromPeerId: 1,
      toPeerId: 2,
      packetType: EasyTierPacketType.Ping,
      flags: 0,
      forwardCounter: 1,
      reserved: 0,
    }, Uint8Array.of(1, 2));
    const right = createEasyTierFrame({
      fromPeerId: 2,
      toPeerId: 1,
      packetType: EasyTierPacketType.Pong,
      flags: 0,
      forwardCounter: 1,
      reserved: 0,
    }, Uint8Array.of(3));
    const message = new Uint8Array(left.byteLength + right.byteLength);
    message.set(left, 0);
    message.set(right, left.byteLength);

    const frames = splitEasyTierFrames(message.buffer);

    expect(frames?.map((item) => item.byteLength)).toEqual([left.byteLength, right.byteLength]);
    expect(parseEasyTierHeader(frames![0])?.packetType).toBe(EasyTierPacketType.Ping);
    expect(parseEasyTierHeader(frames![1])?.packetType).toBe(EasyTierPacketType.Pong);
  });

  it('rejects incomplete batched websocket messages', () => {
    const frame = createEasyTierFrame({
      fromPeerId: 1,
      toPeerId: 2,
      packetType: EasyTierPacketType.Ping,
      flags: 0,
      forwardCounter: 1,
      reserved: 0,
    }, Uint8Array.of(1, 2));

    expect(splitEasyTierFrames(frame.buffer.slice(0, frame.byteLength - 1))).toBeNull();
  });
});
