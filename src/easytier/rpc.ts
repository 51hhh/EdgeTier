import type { EasyTierPacketHeader } from './packet';
import type { HandshakeObservation, RpcObservation } from './types';

const TEXT_DECODER = new TextDecoder();

export function observeHandshake(header: EasyTierPacketHeader, frame: ArrayBuffer): HandshakeObservation {
  const payload = new Uint8Array(frame, 16);
  const text = safeText(payload);
  const networkName = findPrintableField(text, /(network[_-]?name|network)[:=]([a-zA-Z0-9._-]{1,64})/i);
  const digest = findPrintableField(text, /(secret[_-]?digest|digest|network[_-]?secret)[:=]([a-fA-F0-9]{8,128})/i);
  return {
    peerId: header.fromPeerId || undefined,
    networkName,
    networkSecretDigestPrefix: digest ? digest.slice(0, 12) : undefined,
    confidence: networkName || digest ? 'heuristic' : 'header',
  };
}

export function observeRpc(_header: EasyTierPacketHeader, frame: ArrayBuffer): RpcObservation {
  const text = safeText(new Uint8Array(frame, 16));
  if (/SyncRouteInfo|OspfRouteRpc/i.test(text)) {
    return { service: 'OspfRouteRpc.SyncRouteInfo', message: 'route sync RPC observed' };
  }
  if (/PeerCenterRpc|PeerCenter/i.test(text)) {
    return { service: 'PeerCenterRpc', message: 'peer center RPC observed' };
  }
  return { service: 'unknown', message: 'EasyTier RPC envelope observed; full decode is reserved for proto-backed v0.2 work' };
}

function safeText(bytes: Uint8Array): string {
  try {
    return TEXT_DECODER.decode(bytes.slice(0, Math.min(bytes.byteLength, 4096)));
  } catch {
    return '';
  }
}

function findPrintableField(text: string, regex: RegExp): string | undefined {
  const match = regex.exec(text);
  return match?.[2];
}
