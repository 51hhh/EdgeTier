import { describe, expect, it } from 'vitest';
import { EASYTIER_MAGIC } from './constants';
import { buildHandshakeResponse, decodeHandshake, encodeHandshake } from './handshake';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

// Real HandshakeRequest body captured from easytier-core 2.6.4 connecting with
// network_name="home-mesh". (header stripped; this is the protobuf body)
const REAL_HANDSHAKE_BODY =
  '08e1cb868f0d108cf5bca10618012a09686f6d652d6d65736832208fced330af088c60f1ca8b237311f27bf161ec82db630415e338f426daa82cf7';
const REAL_SECRET = 'HkpyEtYJx0nUnEs8HKsiOVjjo8ujOPdyQCVuLZ4G';
const REAL_DIGEST = '8fced330af088c60f1ca8b237311f27bf161ec82db630415e338f426daa82cf7';

describe('EasyTier handshake codec (validated against real easytier-core 2.6.4)', () => {
  it('decodes a real captured HandshakeRequest', () => {
    const req = decodeHandshake(unhex(REAL_HANDSHAKE_BODY));
    expect(req.magic >>> 0).toBe(EASYTIER_MAGIC);
    expect(req.version).toBe(1);
    expect(req.networkName).toBe('home-mesh');
    expect(req.features).toEqual([]);
    expect(hex(req.networkSecretDigest)).toBe(REAL_DIGEST);
    expect(req.myPeerId).toBeGreaterThan(0);
  });

  it('re-encodes byte-identically to the real wire bytes', () => {
    const req = decodeHandshake(unhex(REAL_HANDSHAKE_BODY));
    expect(hex(encodeHandshake(req))).toBe(REAL_HANDSHAKE_BODY);
  });

  it('builds a response whose digest matches the network secret', () => {
    const req = decodeHandshake(unhex(REAL_HANDSHAKE_BODY));
    const resp = buildHandshakeResponse(req, 'home-mesh', REAL_SECRET);
    expect(resp.magic >>> 0).toBe(EASYTIER_MAGIC);
    expect(resp.version).toBe(1);
    expect(resp.networkName).toBe('home-mesh');
    expect(hex(resp.networkSecretDigest)).toBe(REAL_DIGEST);
    // round-trips through the wire codec
    expect(decodeHandshake(encodeHandshake(resp)).networkName).toBe('home-mesh');
  });
});
