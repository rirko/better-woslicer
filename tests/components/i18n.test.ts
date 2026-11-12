import { createPinia, disposePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { setupI18n } from '../../src/i18n/setup';
import { useUiPreferencesStore } from '../../src/ui/preferences';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function translations(locale: string) {
  const pinia = createPinia();
  const setup = setupI18n(pinia, { storage: null, locales: [locale] });
  cleanups.push(() => {
    setup.stop();
    disposePinia(pinia);
  });
  return { ...setup, preferences: useUiPreferencesStore(pinia) };
}

describe('application Vue I18n messages', () => {
  it.each([
    ['en', 'Open', 'Scope: selection'],
    ['zh', '打开', '范围：选区'],
    ['ja', '読込', '範囲：選択'],
    ['ko', '열기', '범위: 선택'],
  ])('renders chrome and scope messages in %s', (locale, open, scope) => {
    const { i18n } = translations(locale);
    expect(i18n.global.t('chrome.open')).toBe(open);
    const text = i18n.global.t('scopeRange', { m0: '001', m1: '003', seconds: '2.50' });
    expect(text.startsWith(scope)).toBe(true);
    for (const parameter of ['001', '003', '2.50']) expect(text).toContain(parameter);
    expect(text).not.toMatch(/\{\w+\}/);
  });

  it('formats status parameters and switches the actual application locale', () => {
    const { i18n, preferences } = translations('en');
    expect(i18n.global.t('status.paintedMarkers', { count: 3 })).toBe('Painted 3 marker(s)');
    preferences.setLanguage('zh');
    expect(i18n.global.t('status.breakPointAtTick', { tick: 12 })).toBe('已在 tick 12 打点');
    expect(i18n.global.t('chrome.framesCount', { count: '1,234' })).toBe('1,234 采样帧');
    preferences.setLanguage('ko');
    expect(i18n.global.t('status.movedMarkersBy', { count: 4, delta: -8 })).toBe(
      '마커 4개를 -8 tick 이동',
    );
  });

  it('falls back to English when the selected locale lacks a message', () => {
    const { i18n } = translations('zh');
    i18n.global.missingWarn = false;
    i18n.global.fallbackWarn = false;
    i18n.global.setLocaleMessage('zh', {});
    expect(i18n.global.t('chrome.open')).toBe('Open');
    expect(i18n.global.t('status.paintedMarkers', { count: 3 })).toBe('Painted 3 marker(s)');
  });
});
