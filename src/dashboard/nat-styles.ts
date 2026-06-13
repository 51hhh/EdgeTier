import { ChartPalette } from '@cloudflare/kumo';

export type NatType = 'Unknown' | 'OpenInternet' | 'NoPAT' | 'FullCone' | 'Restricted' | 'PortRestricted' | 'Symmetric' | 'SymUdpFirewall' | 'SymmetricEasyInc' | 'SymmetricEasyDec';

export interface NatStyle {
  color: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  icon?: string;
}

export const NAT_STYLES: Record<NatType, NatStyle> = {
  Unknown: {
    color: ChartPalette.semantic('Neutral'),
    strokeDasharray: '2 2',
  },
  OpenInternet: {
    color: ChartPalette.semantic('Success'),
    icon: '🌐',
  },
  NoPAT: {
    color: ChartPalette.categorical(2),
    icon: '🔓',
  },
  FullCone: {
    color: ChartPalette.categorical(0),
    icon: '🔵',
  },
  Restricted: {
    color: ChartPalette.categorical(4),
    strokeWidth: 2.5,
    icon: '🟡',
  },
  PortRestricted: {
    color: ChartPalette.categorical(5),
    strokeWidth: 2.5,
    strokeDasharray: '6 2',
    icon: '🟠',
  },
  Symmetric: {
    color: ChartPalette.semantic('Attention'),
    strokeWidth: 3,
    strokeDasharray: '4 4',
    icon: '🔴',
  },
  SymUdpFirewall: {
    color: ChartPalette.semantic('Attention'),
    strokeWidth: 2.5,
    strokeDasharray: '3 3',
    icon: '🔥',
  },
  SymmetricEasyInc: {
    color: ChartPalette.categorical(7),
    strokeWidth: 2.5,
    strokeDasharray: '5 2 2 2',
    icon: '🔺',
  },
  SymmetricEasyDec: {
    color: ChartPalette.categorical(8),
    strokeWidth: 2.5,
    strokeDasharray: '5 2 2 2',
    icon: '🔻',
  },
};

export function natStyleFor(udpNatType?: string | null, tcpNatType?: string | null): NatStyle {
  const natType = (udpNatType || tcpNatType || 'Unknown') as NatType;
  return NAT_STYLES[natType] ?? NAT_STYLES.Unknown;
}

export function nodeColorForPeerId(peerId: number, natType?: string | null): string {
  if (natType && natType !== 'Unknown') {
    return natStyleFor(natType).color;
  }
  // Fallback: deterministic color based on peer ID
  const colorIndex = Math.abs(peerId) % 9;
  return ChartPalette.categorical(colorIndex);
}
