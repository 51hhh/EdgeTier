// Minimal protobuf codec for EasyTier's HandshakeRequest (peer_rpc.proto, easytier 2.6.4):
//   uint32 magic=1; uint32 my_peer_id=2; uint32 version=3;
//   repeated string features=4; string network_name=5; bytes network_secret_digest=6;
// The handshake packet (PacketType.HandShake = 2) is never encrypted.
// Hand-rolled because these are simple fields; richer RPC messages will use a
// full protobuf runtime in a later phase.

import { EASYTIER_MAGIC, EASYTIER_VERSION, EDGE_PEER_ID } from './constants';
import { generateDigestFromStr } from './crypto';

export interface HandshakeRequest {
  magic: number;
  myPeerId: number;
  version: number;
  features: string[];
  networkName: string;
  networkSecretDigest: Uint8Array;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  get done(): boolean { return this.pos >= this.buf.length; }
  varint(): number {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = this.buf[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
    }
    return Number(result);
  }
  bytes(): Uint8Array {
    const len = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
}

function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
}

function writeTag(out: number[], field: number, wireType: number): void {
  writeVarint(out, (field << 3) | wireType);
}

function writeLenDelim(out: number[], field: number, payload: Uint8Array): void {
  writeTag(out, field, 2);
  writeVarint(out, payload.length);
  for (const b of payload) out.push(b);
}

export function decodeHandshake(body: Uint8Array): HandshakeRequest {
  const r = new Reader(body);
  const req: HandshakeRequest = { magic: 0, myPeerId: 0, version: 0, features: [], networkName: '', networkSecretDigest: new Uint8Array(0) };
  while (!r.done) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 0) req.magic = r.varint() >>> 0;
    else if (field === 2 && wire === 0) req.myPeerId = r.varint() >>> 0;
    else if (field === 3 && wire === 0) req.version = r.varint() >>> 0;
    else if (field === 4 && wire === 2) req.features.push(textDecoder.decode(r.bytes()));
    else if (field === 5 && wire === 2) req.networkName = textDecoder.decode(r.bytes());
    else if (field === 6 && wire === 2) req.networkSecretDigest = new Uint8Array(r.bytes());
    else if (wire === 0) r.varint();
    else if (wire === 2) r.bytes();
    else throw new Error(`unsupported wire type ${wire} for field ${field}`);
  }
  return req;
}

export function encodeHandshake(req: HandshakeRequest): Uint8Array {
  const out: number[] = [];
  if (req.magic) { writeTag(out, 1, 0); writeVarint(out, req.magic); }
  if (req.myPeerId) { writeTag(out, 2, 0); writeVarint(out, req.myPeerId); }
  if (req.version) { writeTag(out, 3, 0); writeVarint(out, req.version); }
  for (const f of req.features) writeLenDelim(out, 4, textEncoder.encode(f));
  if (req.networkName) writeLenDelim(out, 5, textEncoder.encode(req.networkName));
  if (req.networkSecretDigest.length) writeLenDelim(out, 6, req.networkSecretDigest);
  return Uint8Array.from(out);
}

/**
 * Build EdgeTier's handshake response for a client request. EdgeTier answers as a
 * shared node: echo magic/version, advertise its own peer id, and return the
 * network_secret_digest derived from the network it is serving.
 */
export function buildHandshakeResponse(clientReq: HandshakeRequest, networkName: string, networkSecret: string): HandshakeRequest {
  return {
    magic: EASYTIER_MAGIC,
    myPeerId: EDGE_PEER_ID,
    version: EASYTIER_VERSION,
    features: [],
    networkName,
    networkSecretDigest: generateDigestFromStr(networkName, networkSecret, 32),
  };
}

export function buildHandshakeRequest(networkName: string, networkSecret: string): HandshakeRequest {
  return {
    magic: EASYTIER_MAGIC,
    myPeerId: EDGE_PEER_ID,
    version: EASYTIER_VERSION,
    features: [],
    networkName,
    networkSecretDigest: generateDigestFromStr(networkName, networkSecret, 32),
  };
}
