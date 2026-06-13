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

export function formatByteRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '-';
  const normalized = Math.max(0, Math.min(1, value));
  return `${(normalized * 100).toFixed(normalized < 0.01 && normalized > 0 ? 2 : 1)}%`;
}

export function eventBadgeVariant(type: RelayEventType): 'primary' | 'secondary' | 'destructive' | 'outline' {
  if (type === 'decode_error' || type === 'limit_exceeded') return 'destructive';
  if (type === 'packet_unroutable') return 'outline';
  if (type === 'connected' || type === 'packet_forwarded' || type === 'handshake_seen') return 'primary';
  return 'secondary';
}
