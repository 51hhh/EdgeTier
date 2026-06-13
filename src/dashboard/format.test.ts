import { describe, expect, it } from 'vitest';
import { eventBadgeVariant, formatByteRate, formatBytes, formatPercent } from './format';

describe('dashboard format helpers', () => {
  it('formats bytes through GiB and handles unsafe values', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GiB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });

  it('formats byte rates and percentages', () => {
    expect(formatByteRate(1536)).toBe('1.5 KiB/s');
    expect(formatPercent(undefined)).toBe('-');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(formatPercent(0.0005)).toBe('0.05%');
    expect(formatPercent(2)).toBe('100.0%');
  });

  it('maps event types to semantic badge variants', () => {
    expect(eventBadgeVariant('decode_error')).toBe('destructive');
    expect(eventBadgeVariant('limit_exceeded')).toBe('destructive');
    expect(eventBadgeVariant('packet_unroutable')).toBe('outline');
    expect(eventBadgeVariant('connected')).toBe('primary');
    expect(eventBadgeVariant('rpc_seen')).toBe('secondary');
  });
});
