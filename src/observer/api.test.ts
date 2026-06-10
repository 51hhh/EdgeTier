import { describe, expect, it } from 'vitest';
import { validRoom } from './api';

describe('validRoom', () => {
  it('accepts supported room names', () => {
    expect(validRoom('test')).toBe(true);
    expect(validRoom('home-mesh_01.prod')).toBe(true);
    expect(validRoom('A'.repeat(64))).toBe(true);
  });

  it('rejects missing, unsafe, and too-long room names', () => {
    expect(validRoom(null)).toBe(false);
    expect(validRoom('')).toBe(false);
    expect(validRoom('-starts-with-dash')).toBe(false);
    expect(validRoom('../secret')).toBe(false);
    expect(validRoom('has space')).toBe(false);
    expect(validRoom('A'.repeat(65))).toBe(false);
  });
});
