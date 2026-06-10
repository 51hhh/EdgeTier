import type { RelayEventType } from '../observer/types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}

export function eventBadgeVariant(type: RelayEventType): 'primary' | 'secondary' | 'destructive' | 'outline' {
  if (type === 'decode_error' || type === 'limit_exceeded') return 'destructive';
  if (type === 'packet_unroutable') return 'outline';
  if (type === 'connected' || type === 'packet_forwarded' || type === 'handshake_seen') return 'primary';
  return 'secondary';
}
