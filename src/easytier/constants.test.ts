import { describe, expect, it } from 'vitest';
import { ROOM_NAME_PATTERN } from './constants';

describe('room name validation', () => {
  it('accepts safe room names', () => {
    expect(ROOM_NAME_PATTERN.test('home')).toBe(true);
    expect(ROOM_NAME_PATTERN.test('home-mesh_1.prod')).toBe(true);
    expect(ROOM_NAME_PATTERN.test('a'.repeat(64))).toBe(true);
  });

  it('rejects missing, unsafe, and overlong room names', () => {
    expect(ROOM_NAME_PATTERN.test('')).toBe(false);
    expect(ROOM_NAME_PATTERN.test('-home')).toBe(false);
    expect(ROOM_NAME_PATTERN.test('../secret')).toBe(false);
    expect(ROOM_NAME_PATTERN.test('home/mesh')).toBe(false);
    expect(ROOM_NAME_PATTERN.test('a'.repeat(65))).toBe(false);
  });
});
