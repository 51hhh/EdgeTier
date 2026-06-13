import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n';

describe('dashboard i18n', () => {
  it('translates and interpolates English messages', () => {
    const t = createTranslator('en');
    expect(t('app.room', { room: 'home-mesh' })).toBe('room home-mesh');
    expect(t('overview.outboundConnected', { connected: 1, count: 2 })).toBe('1/2 connected');
  });

  it('translates and interpolates Chinese messages', () => {
    const t = createTranslator('zh');
    expect(t('app.room', { room: 'home-mesh' })).toBe('房间 home-mesh');
    expect(t('overview.outboundConnected', { connected: 1, count: 2 })).toBe('1/2 已连接');
  });
});
