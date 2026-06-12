// EasyTier crypto, ported byte-for-byte from the authoritative Rust source
// (easytier 2.6.4, easytier/src/common/global_ctx.rs and peers/encrypt/aes_gcm.rs)
// and cross-checked against the cf-workers-et-ws JS implementation.
//
// Key derivation uses Rust's std DefaultHasher = SipHash-1-3 with keys (0, 0),
// incremental write + big-endian finish. AES-GCM payload tail is
// `tag(16) || nonce(12)` appended after the ciphertext, with empty AAD.

const U64_MASK = (1n << 64n) - 1n;
const textEncoder = new TextEncoder();

function rotl64(x: bigint, b: number): bigint {
  const bb = BigInt(b);
  return ((x << bb) | (x >> (64n - bb))) & U64_MASK;
}

function readUInt64LE(buf: Uint8Array, offset: number): bigint {
  let r = 0n;
  for (let i = 0; i < 8; i += 1) r |= BigInt(buf[offset + i]) << (8n * BigInt(i));
  return r;
}

interface SipState { v0: bigint; v1: bigint; v2: bigint; v3: bigint }

function sipRound(v: SipState): void {
  v.v0 = (v.v0 + v.v1) & U64_MASK; v.v1 = rotl64(v.v1, 13); v.v1 ^= v.v0; v.v0 = rotl64(v.v0, 32);
  v.v2 = (v.v2 + v.v3) & U64_MASK; v.v3 = rotl64(v.v3, 16); v.v3 ^= v.v2;
  v.v0 = (v.v0 + v.v3) & U64_MASK; v.v3 = rotl64(v.v3, 21); v.v3 ^= v.v0;
  v.v2 = (v.v2 + v.v1) & U64_MASK; v.v1 = rotl64(v.v1, 17); v.v1 ^= v.v2; v.v2 = rotl64(v.v2, 32);
}

/** SipHash-1-3 with keys (0, 0), matching Rust std DefaultHasher. */
export function sipHash13(msg: Uint8Array, k0 = 0n, k1 = 0n): bigint {
  const b = BigInt(msg.length) << 56n;
  const v: SipState = {
    v0: 0x736f6d6570736575n ^ k0,
    v1: 0x646f72616e646f6dn ^ k1,
    v2: 0x6c7967656e657261n ^ k0,
    v3: 0x7465646279746573n ^ k1,
  };
  const fullLen = msg.length - (msg.length % 8);
  for (let i = 0; i < fullLen; i += 8) {
    const m = readUInt64LE(msg, i);
    v.v3 ^= m; sipRound(v); v.v0 ^= m;
  }
  let m = b;
  const left = msg.length % 8;
  for (let i = 0; i < left; i += 1) m |= BigInt(msg[fullLen + i]) << (8n * BigInt(i));
  v.v3 ^= m; sipRound(v); v.v0 ^= m;
  v.v2 ^= 0xffn; sipRound(v); sipRound(v); sipRound(v);
  return (v.v0 ^ v.v1 ^ v.v2 ^ v.v3) & U64_MASK;
}

/** Mirrors Rust DefaultHasher streaming: each finish() hashes the full accumulated message. */
export class DefaultHasher {
  private parts: Uint8Array[] = [];
  private total = 0;

  write(buf: Uint8Array): void {
    if (!buf || buf.length === 0) return;
    this.parts.push(buf);
    this.total += buf.length;
  }

  finish(): bigint {
    if (this.parts.length === 1) return sipHash13(this.parts[0]);
    const msg = new Uint8Array(this.total);
    let offset = 0;
    for (const part of this.parts) { msg.set(part, offset); offset += part.length; }
    return sipHash13(msg);
  }
}

function u64ToBeBytes(u64: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let x = u64;
  for (let i = 7; i >= 0; i -= 1) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

export interface DerivedKeys { key128: Uint8Array; key256: Uint8Array }

/** Derive AES-128 and AES-256 keys from network_secret (matches Rust get_128_key/get_256_key). */
export function deriveKeys(networkSecret = ''): DerivedKeys {
  const secret = textEncoder.encode(networkSecret);

  const h128 = new DefaultHasher();
  h128.write(secret);
  const key128 = new Uint8Array(16);
  key128.set(u64ToBeBytes(h128.finish()), 0);
  h128.write(key128.subarray(0, 8));
  key128.set(u64ToBeBytes(h128.finish()), 8);
  h128.write(key128.subarray(0, 16));

  const h256 = new DefaultHasher();
  h256.write(secret);
  h256.write(textEncoder.encode('easytier-256bit-key'));
  const key256 = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    const chunkStart = i * 8;
    if (chunkStart > 0) h256.write(key256.subarray(0, chunkStart));
    h256.write(Uint8Array.of(i));
    key256.set(u64ToBeBytes(h256.finish()), chunkStart);
  }
  return { key128, key256 };
}

/** Network-secret digest (e.g. for handshake), matching the streaming finish() shard pattern. */
export function generateDigestFromStr(str1: string, str2: string, digestLen = 32): Uint8Array {
  if (!Number.isInteger(digestLen) || digestLen <= 0 || digestLen % 8 !== 0) {
    throw new Error('digest length must be a positive multiple of 8');
  }
  const hasher = new DefaultHasher();
  hasher.write(textEncoder.encode(str1 ?? ''));
  hasher.write(textEncoder.encode(str2 ?? ''));
  const digest = new Uint8Array(digestLen);
  const shards = digestLen / 8;
  for (let i = 0; i < shards; i += 1) {
    digest.set(u64ToBeBytes(hasher.finish()), i * 8);
    hasher.write(digest.subarray(0, (i + 1) * 8));
  }
  return digest;
}

const TAG_SIZE = 16;
const NONCE_SIZE = 12;
export const AEAD_TAIL_SIZE = TAG_SIZE + NONCE_SIZE;

async function importAesKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', copy(key), { name: 'AES-GCM' }, false, [usage]);
}

/** Copy into a fresh ArrayBuffer-backed Uint8Array so WebCrypto's BufferSource typing is satisfied. */
function copy(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(view.length);
  const out = new Uint8Array(buffer);
  out.set(view);
  return out;
}

/** Encrypt to EasyTier layout: ciphertext || tag(16) || nonce(12), empty AAD. */
export async function encryptAesGcm(plaintext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE));
  const cryptoKey = await importAesKey(key, 'encrypt');
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cryptoKey, copy(plaintext)));
  // WebCrypto appends the tag after the ciphertext: [ciphertext || tag]
  const out = new Uint8Array(sealed.length + NONCE_SIZE);
  out.set(sealed, 0);
  out.set(nonce, sealed.length);
  return out;
}

/** Decrypt EasyTier layout: ciphertext || tag(16) || nonce(12), empty AAD. */
export async function decryptAesGcm(payload: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (payload.length < AEAD_TAIL_SIZE) throw new Error(`encrypted payload too short: ${payload.length}`);
  const textLen = payload.length - AEAD_TAIL_SIZE;
  const ciphertextAndTag = copy(payload.subarray(0, textLen + TAG_SIZE)); // WebCrypto wants [ciphertext || tag]
  const nonce = copy(payload.subarray(textLen + TAG_SIZE));
  const cryptoKey = await importAesKey(key, 'decrypt');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cryptoKey, ciphertextAndTag));
}
