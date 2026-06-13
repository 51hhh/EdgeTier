import { ChartPalette } from '@cloudflare/kumo';

export type NatType = 'Unknown' | 'OpenInternet' | 'NoPAT' | 'FullCone' | 'Restricted' | 'PortRestricted' | 'Symmetric' | 'SymUdpFirewall' | 'SymmetricEasyInc' | 'SymmetricEasyDec';

export interface NatStyle {
  icon: string;
  shape: 'circle' | 'square' | 'diamond' | 'hexagon';
  badgeColor: string;
  description: string;
}

export const NAT_STYLES: Record<NatType, NatStyle> = {
  Unknown: {
    icon: '❓',
    shape: 'circle',
    badgeColor: ChartPalette.semantic('Neutral'),
    description: 'Unknown NAT',
  },
  OpenInternet: {
    icon: '🌐',
    shape: 'circle',
    badgeColor: ChartPalette.semantic('Success'),
    description: 'Open Internet',
  },
  NoPAT: {
    icon: '🔓',
    shape: 'circle',
    badgeColor: ChartPalette.categorical(2),
    description: 'No PAT',
  },
  FullCone: {
    icon: '🔵',
    shape: 'hexagon',
    badgeColor: ChartPalette.categorical(0),
    description: 'Full Cone NAT',
  },
  Restricted: {
    icon: '🟡',
    shape: 'square',
    badgeColor: ChartPalette.categorical(4),
    description: 'Restricted NAT',
  },
  PortRestricted: {
    icon: '🟠',
    shape: 'square',
    badgeColor: ChartPalette.categorical(5),
    description: 'Port Restricted NAT',
  },
  Symmetric: {
    icon: '🔴',
    shape: 'diamond',
    badgeColor: ChartPalette.semantic('Attention'),
    description: 'Symmetric NAT',
  },
  SymUdpFirewall: {
    icon: '🔥',
    shape: 'diamond',
    badgeColor: ChartPalette.semantic('Attention'),
    description: 'Symmetric UDP Firewall',
  },
  SymmetricEasyInc: {
    icon: '🔺',
    shape: 'diamond',
    badgeColor: ChartPalette.categorical(7),
    description: 'Symmetric Easy Inc',
  },
  SymmetricEasyDec: {
    icon: '🔻',
    shape: 'diamond',
    badgeColor: ChartPalette.categorical(8),
    description: 'Symmetric Easy Dec',
  },
};

export function natStyleFor(udpNatType?: string | null, tcpNatType?: string | null): NatStyle {
  const natType = (udpNatType || tcpNatType || 'Unknown') as NatType;
  return NAT_STYLES[natType] ?? NAT_STYLES.Unknown;
}

export function nodeColorForPeerId(peerId: number): string {
  // Deterministic color based on peer ID for node distinction
  const colorIndex = Math.abs(peerId) % 9;
  return ChartPalette.categorical(colorIndex);
}
