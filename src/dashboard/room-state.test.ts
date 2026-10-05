import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../observer/types';
import { createSelectionGuard, roomForSelection } from './room-state';

const alpha = { roomId: 'alpha', peers: [{ hostname: 'alpha-node' }] } as RoomSnapshot;

describe('room identity boundaries', () => {
  it('retains same-room data through errors and blocks a previous room during a new failed fetch', () => {
    expect(roomForSelection(alpha, 'alpha')).toBe(alpha);
    expect(roomForSelection(alpha, 'beta')).toBeNull();
    expect(roomForSelection(alpha, null)).toBeNull();
    expect(roomForSelection(null, 'beta')).toBeNull();
  });
  it('ignores a late room token response after selection changes and returns', async () => {
    const guard = createSelectionGuard();
    guard.select('alpha');
    const ticket = guard.capture();
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => { resolve = done; });
    let applied: string | undefined;
    const request = response.then((value) => { if (guard.isCurrent(ticket)) applied = value; });
    guard.select('beta');
    guard.select('alpha');
    resolve('old-alpha-token');
    await request;
    expect(applied).toBeUndefined();
  });
  it('invalidates unmounted requests and restores the active identity through effect replay', () => {
    const guard = createSelectionGuard();
    guard.select('alpha');
    const beforeCleanup = guard.capture();
    guard.select(null);
    guard.select('alpha');
    expect(guard.isCurrent(beforeCleanup)).toBe(false);
    expect(guard.isCurrent(guard.capture())).toBe(true);
  });
  it('accepts a response within the same selection and does not invalidate on a normal render', () => {
    const guard = createSelectionGuard();
    guard.select('alpha');
    const ticket = guard.capture();
    guard.select('alpha');
    expect(guard.isCurrent(ticket)).toBe(true);
    guard.select(null);
    expect(guard.isCurrent(ticket)).toBe(false);
  });
});
