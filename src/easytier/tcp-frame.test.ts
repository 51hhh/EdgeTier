import { describe, expect, it } from 'vitest';
import { createEasyTierFrame } from './packet';
import { encodeTcpTunnelFrame, parseTcpPeerUri, TcpTunnelFrameDecoder } from './tcp-frame';

function payload(id: number): Uint8Array {
  return createEasyTierFrame({ fromPeerId: id, toPeerId: 2, packetType: 4, flags: 0, forwardCounter: 1, reserved: 0 }, new Uint8Array([id]));
}

describe('EasyTier TCP tunnel framing', () => {
  it('encodes payload length as a 4-byte little-endian prefix', () => {
    const inner = payload(1);
    const framed = encodeTcpTunnelFrame(inner);
    expect(new DataView(framed.buffer).getUint32(0, true)).toBe(inner.byteLength);
    expect([...framed.slice(4)]).toEqual([...inner]);
  });

  it('splits coalesced and fragmented TCP chunks into EasyTier frames', () => {
    const a = encodeTcpTunnelFrame(payload(1));
    const b = encodeTcpTunnelFrame(payload(2));
    const stream = new Uint8Array(a.byteLength + b.byteLength);
    stream.set(a, 0);
    stream.set(b, a.byteLength);

    const decoder = new TcpTunnelFrameDecoder();
    expect(decoder.push(stream.slice(0, 5))).toEqual([]);
    const first = decoder.push(stream.slice(5, a.byteLength + 3));
    expect(first).not.toBeNull();
    expect(first).toHaveLength(1);
    const second = decoder.push(stream.slice(a.byteLength + 3));
    expect(second).not.toBeNull();
    expect(second).toHaveLength(1);
    expect(new Uint8Array(first![0])[0]).toBe(1);
    expect(new Uint8Array(second![0])[0]).toBe(2);
  });

  it('rejects invalid TCP frame lengths', () => {
    const tooShort = new Uint8Array(4);
    new DataView(tooShort.buffer).setUint32(0, 15, true);
    expect(new TcpTunnelFrameDecoder().push(tooShort)).toBeNull();

    const tooLarge = new Uint8Array(4);
    new DataView(tooLarge.buffer).setUint32(0, 2001, true);
    expect(new TcpTunnelFrameDecoder().push(tooLarge)).toBeNull();
  });
});

describe('parseTcpPeerUri', () => {
  it('accepts tcp URIs and host:port shorthands', () => {
    expect(parseTcpPeerUri('tcp://example.com:11010')).toEqual({ uri: 'tcp://example.com:11010', hostname: 'example.com', port: 11010 });
    expect(parseTcpPeerUri('example.com:11010')).toEqual({ uri: 'tcp://example.com:11010', hostname: 'example.com', port: 11010 });
  });

  it('rejects unsupported or incomplete peer URIs', () => {
    expect(parseTcpPeerUri('udp://example.com:11010')).toBeNull();
    expect(parseTcpPeerUri('tcp://example.com')).toBeNull();
    expect(parseTcpPeerUri('tcp://user@example.com:11010')).toBeNull();
    expect(parseTcpPeerUri('tcp://example.com:70000')).toBeNull();
  });
});
