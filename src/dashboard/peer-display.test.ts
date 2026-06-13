import { describe, expect, it } from 'vitest';
import { EDGE_PEER_ID } from '../easytier/constants';
import { compactPeerDisplayName, peerDisplayName, peerFullLabel, shortPeerId } from './peer-display';

describe('dashboard peer display helpers', () => {
  it('shortens long peer ids while keeping EdgeTier recognizable', () => {
    expect(shortPeerId(undefined)).toBe('unknown');
    expect(shortPeerId(12345)).toBe('12345');
    expect(shortPeerId(4018890303)).toBe('...890303');
    expect(shortPeerId(EDGE_PEER_ID)).toBe('Edge');
  });

  it('prefers hostnames but keeps the full peer id in detail labels', () => {
    expect(peerDisplayName({ peerId: 4018890303, hostname: 'home-kwrt' })).toBe('home-kwrt');
    expect(peerDisplayName({ peerId: 4018890303 })).toBe('peer ...890303');
    expect(peerFullLabel({ peerId: 4018890303, hostname: 'home-kwrt' })).toBe('home-kwrt - peer ...890303 (4018890303)');
  });

  it('compacts graph labels while preserving full labels elsewhere', () => {
    expect(compactPeerDisplayName({ peerId: 1, hostname: 'toe2-ubuntu24' })).toBe('toe2-ubuntu24');
    expect(compactPeerDisplayName({ peerId: 1, hostname: 'very-long-hostname-for-graph' })).toBe('very-long-hos...');
    expect(compactPeerDisplayName({ peerId: 1, hostname: '边缘节点拓扑图标签很长' }, 'unknown', 8)).toBe('边缘节点拓...');
    expect(compactPeerDisplayName({ peerId: 4018890303 })).toBe('peer ...890303');
  });
});
