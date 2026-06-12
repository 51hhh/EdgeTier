import { describe, expect, it } from 'vitest';
import { AEAD_TAIL_SIZE, decryptAesGcm, deriveKeys, encryptAesGcm, generateDigestFromStr } from './crypto';

const td = new TextDecoder();
const te = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

// Reference vectors generated from the proven cf-workers-et-ws JS implementation,
// which is byte-for-byte aligned with the authoritative easytier 2.6.4 Rust source.
describe('EasyTier key derivation (vectors locked to upstream)', () => {
  it('derives key128/key256 from a network secret', () => {
    const { key128, key256 } = deriveKeys('HkpyEtYJx0nUnEs8HKsiOVjjo8ujOPdyQCVuLZ4G');
    expect(hex(key128)).toBe('3df48a613b85eebc0f3095102a5e689f');
    expect(hex(key256)).toBe('ade44040a0a8cf5e2104596952a20eb30b95b7e5198923039be3335187b6c31f');
  });

  it('handles the empty secret', () => {
    expect(hex(deriveKeys('').key128)).toBe('d1fba762150c532c4cf426633e76377d');
  });

  it('computes network-secret digests', () => {
    const digest = generateDigestFromStr('home-mesh', 'HkpyEtYJx0nUnEs8HKsiOVjjo8ujOPdyQCVuLZ4G', 32);
    expect(hex(digest)).toBe('8fced330af088c60f1ca8b237311f27bf161ec82db630415e338f426daa82cf7');
  });
});

describe('EasyTier AES-GCM interop', () => {
  it('decrypts a ciphertext produced by the upstream JS implementation', async () => {
    const key128 = unhex('2fa067e1dccbbf1d86fddc1e1a5b4acc');
    const ct = unhex('60f3792fe568e67416cdfa1613e920adc4d18b1c3fd0b14f4624532216b47b3177e25ccac783d7535fc36096fb1ed870345f');
    const pt = await decryptAesGcm(ct, key128);
    expect(td.decode(pt)).toBe('EdgeTier interop check');
  });

  it('round-trips with AES-128 and AES-256 keys', async () => {
    const { key128, key256 } = deriveKeys('round-trip');
    const msg = te.encode('hello easytier');
    for (const key of [key128, key256]) {
      const ct = await encryptAesGcm(msg, key);
      expect(ct.length).toBe(msg.length + AEAD_TAIL_SIZE);
      expect(td.decode(await decryptAesGcm(ct, key))).toBe('hello easytier');
    }
  });

  it('rejects payloads shorter than the AEAD tail', async () => {
    await expect(decryptAesGcm(new Uint8Array(10), deriveKeys('x').key128)).rejects.toThrow();
  });
});
