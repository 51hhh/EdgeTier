import { describe, expect, it } from 'vitest';
import { eventBadgeVariant, formatBytes } from './format';

describe('dashboard format helpers', () => {
  it('formats bytes through GiB and handles unsafe values', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GiB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });

  it('maps event types to semantic badge variants', () => {
    expect(eventBadgeVariant('decode_error')).toBe('destructive');
    expect(eventBadgeVariant('limit_exceeded')).toBe('destructive');
    expect(eventBadgeVariant('packet_unroutable')).toBe('outline');
    expect(eventBadgeVariant('connected')).toBe('primary');
    expect(eventBadgeVariant('rpc_seen')).toBe('secondary');
  });
});
