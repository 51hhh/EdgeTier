import { EASYTIER_HEADER_SIZE } from './constants';

export const EASYTIER_TCP_TUNNEL_HEADER_SIZE = 4;
export const EASYTIER_TCP_MTU_BYTES = 2000;

export interface TcpPeerAddress {
  uri: string;
  hostname: string;
  port: number;
}

export function encodeTcpTunnelFrame(payload: Uint8Array | ArrayBuffer, maxPayloadSize = EASYTIER_TCP_MTU_BYTES): Uint8Array<ArrayBuffer> {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.byteLength < EASYTIER_HEADER_SIZE) throw new RangeError('EasyTier TCP payload is too short');
  if (bytes.byteLength > maxPayloadSize) throw new RangeError('EasyTier TCP payload is too large');
  const frame = new Uint8Array(EASYTIER_TCP_TUNNEL_HEADER_SIZE + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, bytes.byteLength, true);
  frame.set(bytes, EASYTIER_TCP_TUNNEL_HEADER_SIZE);
  return frame;
}

export class TcpTunnelFrameDecoder {
  private pending = new Uint8Array(0);

  constructor(private readonly maxPayloadSize = EASYTIER_TCP_MTU_BYTES) {}

  push(chunk: Uint8Array | ArrayBuffer): ArrayBuffer[] | null {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const merged = new Uint8Array(this.pending.byteLength + bytes.byteLength);
    merged.set(this.pending, 0);
    merged.set(bytes, this.pending.byteLength);
    this.pending = merged;

    const frames: ArrayBuffer[] = [];
    let offset = 0;
    while (this.pending.byteLength - offset >= EASYTIER_TCP_TUNNEL_HEADER_SIZE) {
      const view = new DataView(this.pending.buffer, this.pending.byteOffset + offset, EASYTIER_TCP_TUNNEL_HEADER_SIZE);
      const payloadLength = view.getUint32(0, true);
      if (payloadLength > this.maxPayloadSize || payloadLength < EASYTIER_HEADER_SIZE) return null;
      const totalLength = EASYTIER_TCP_TUNNEL_HEADER_SIZE + payloadLength;
      if (this.pending.byteLength - offset < totalLength) break;

      const start = offset + EASYTIER_TCP_TUNNEL_HEADER_SIZE;
      frames.push(copyArrayBuffer(this.pending.subarray(start, start + payloadLength)));
      offset += totalLength;
    }

    this.pending = this.pending.subarray(offset);
    return frames;
  }
}

export function parseTcpPeerUri(value: string): TcpPeerAddress | null {
  const raw = value.trim();
  if (!raw) return null;
  const candidate = raw.includes('://') ? raw : `tcp://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'tcp:' || !url.hostname || !url.port || url.username || url.password) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  return { uri: `tcp://${url.host}`, hostname, port };
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
