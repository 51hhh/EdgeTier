import { EDGE_PEER_ID } from '../easytier/constants';

export interface PeerIdentityFields {
  peerId?: number;
  hostname?: string;
}

export function shortPeerId(peerId: number | undefined, fallback = 'unknown'): string {
  if (peerId === undefined) return fallback;
  if (peerId === EDGE_PEER_ID) return 'Edge';
  const text = String(peerId);
  return text.length <= 6 ? text : `...${text.slice(-6)}`;
}

export function peerDisplayName(peer: PeerIdentityFields, fallback = 'unknown'): string {
  if (peer.hostname) return peer.hostname;
  if (peer.peerId !== undefined) return `peer ${shortPeerId(peer.peerId, fallback)}`;
  return fallback;
}

export function compactPeerDisplayName(peer: PeerIdentityFields, fallback = 'unknown', maxLength = 16): string {
  const name = peerDisplayName(peer, fallback);
  if (name.length <= maxLength) return name;
  if (maxLength <= 3) return name.slice(0, Math.max(0, maxLength));
  return `${name.slice(0, maxLength - 3)}...`;
}

export function peerFullLabel(peer: PeerIdentityFields, fallback = 'unknown'): string {
  if (peer.peerId === undefined) return peer.hostname ?? fallback;
  const peerId = `peer ${shortPeerId(peer.peerId, fallback)} (${peer.peerId})`;
  return peer.hostname ? `${peer.hostname} - ${peerId}` : peerId;
}
