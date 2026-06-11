import { describe, expect, it } from 'vitest';
import { toArrayBuffer } from './relay-room';

describe('toArrayBuffer', () => {
  it('encodes strings to UTF-8 buffers', () => {
    const buf = toArrayBuffer('hi');
    expect(buf).not.toBeNull();
    expect(new Uint8Array(buf!)).toEqual(new Uint8Array([0x68, 0x69]));
  });

  it('returns ArrayBuffer inputs unchanged in content', () => {
    const src = new Uint8Array([1, 2, 3]).buffer;
    expect(toArrayBuffer(src)).toBe(src);
  });

  it('copies a TypedArray view honoring byteOffset', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5); // [1,2,3] at byteOffset 2
    const buf = toArrayBuffer(view);
    expect(buf).not.toBeNull();
    expect(new Uint8Array(buf!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(buf!.byteLength).toBe(3);
  });

  it('returns null for unsupported payloads', () => {
    expect(toArrayBuffer(undefined)).toBeNull();
    expect(toArrayBuffer(42 as unknown)).toBeNull();
  });
});
