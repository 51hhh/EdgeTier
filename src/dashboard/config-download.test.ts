import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadConfig } from './config-download';

function downloadEnvironment() {
  const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
  const appendChild = vi.fn();
  const createObjectURL = vi.fn(() => 'blob:test-config');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  return { anchor, appendChild, createObjectURL, revokeObjectURL };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('configuration download handoff', () => {
  it('clicks an attached hidden link and leaves its URL alive for the browser download', () => {
    vi.useFakeTimers();
    const { anchor, appendChild, revokeObjectURL } = downloadEnvironment();
    anchor.click.mockImplementation(() => { expect(appendChild).toHaveBeenCalledWith(anchor); });
    downloadConfig('network_secret = "verification-placeholder"', 'easytier-home.toml');
    expect(anchor.download).toBe('easytier-home.toml');
    expect(anchor.hidden).toBe(true);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-config');
  });
  it('cleans up the link and URL even if the browser rejects the click', () => {
    vi.useFakeTimers();
    const { anchor, revokeObjectURL } = downloadEnvironment();
    anchor.click.mockImplementation(() => { throw new Error('download unavailable'); });
    expect(() => downloadConfig('verification-placeholder', 'client.toml')).toThrow('download unavailable');
    expect(anchor.remove).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(30_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-config');
  });
});
