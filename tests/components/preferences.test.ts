import { createPinia, disposePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiPreferencesStore } from '../../src/ui/preferences';
import { setupI18n } from '../../src/i18n/setup';
import { readFileSync } from 'node:fs';
const dictionary = (language: string): unknown =>
  JSON.parse(readFileSync(`${process.cwd()}/src/i18n/${language}.json`, 'utf8'));
const en = dictionary('en');
const zh = dictionary('zh');
const ja = dictionary('ja');
const ko = dictionary('ko');
import { validateMessages } from '../../src/i18n/validation';

const pinia = createPinia();
afterEach(() => {
  disposePinia(pinia);
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

function preferences() {
  return useUiPreferencesStore(createPinia());
}

describe('UI preferences', () => {
  it('resolves a legacy system theme once and persists a concrete choice', () => {
    localStorage.setItem('woslicer.theme', 'system');
    let dark = true;
    const store = preferences();
    store.initialize({ storage: localStorage, locales: ['ja-JP'], prefersDark: () => dark });
    expect(store.theme).toBe('dark');
    expect(localStorage.getItem('woslicer.theme')).toBe('dark');
    dark = false;
    store.initialize({ storage: localStorage, prefersDark: () => dark });
    expect(store.theme).toBe('dark');
    expect(store.language).toBe('auto');
    expect(store.resolvedLanguage).toBe('ja');
    store.$dispose();
  });

  it('keeps explicit language and theme choices across a fresh store', () => {
    const store = preferences();
    store.initialize({ storage: localStorage, locales: ['zh-TW'], prefersDark: () => false });
    store.setTheme('dark');
    store.setLanguage('ko');
    store.setTheme('system');
    store.setLanguage('unsupported');
    const reopened = preferences();
    reopened.initialize({ storage: localStorage, locales: ['en-US'] });
    expect(reopened.theme).toBe('dark');
    expect(reopened.resolvedLanguage).toBe('ko');
    reopened.language = 'auto';
    expect(reopened.resolvedLanguage).toBe('en');
    expect(localStorage.getItem('woslicer.language')).toBeNull();
    store.$dispose();
    reopened.$dispose();
  });

  it('works with unavailable storage and unsupported preferred locales', () => {
    const storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem() {
        throw new Error('unavailable');
      },
      setItem() {
        throw new Error('unavailable');
      },
      removeItem() {
        throw new Error('unavailable');
      },
    };
    const store = preferences();
    expect(() =>
      store.initialize({ storage, locales: ['fr-FR', 'ko-KR'], prefersDark: () => false }),
    ).not.toThrow();
    expect(store.resolvedLanguage).toBe('ko');
    store.language = 'en';
    expect(store.resolvedLanguage).toBe('en');
    store.$dispose();
  });

  it('reports native theme failures and does not resend theme on language changes', async () => {
    const instance = createPinia();
    const setup = setupI18n(instance, { storage: null, locales: ['en'] });
    const failure = new Error('host unavailable');
    const setTheme = vi.fn(() => Promise.reject(failure));
    const onError = vi.fn();
    setup.syncAppearance({ setTheme }, onError);
    useUiPreferencesStore(instance).language = 'ko';
    await Promise.resolve();
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    setup.stop();
    disposePinia(instance);
  });

  it('synchronizes composition translations, Element locale, and document appearance', () => {
    const instance = createPinia();
    const setup = setupI18n(instance, {
      storage: null,
      locales: ['ja-JP'],
      prefersDark: () => true,
    });
    const stopAppearance = setup.syncAppearance();
    const store = useUiPreferencesStore(instance);
    expect(setup.i18n.global.t('chrome.bmhNewDivision')).toBe('新規分割');
    expect(setup.elementLocale.value.name).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    store.language = 'zh';
    store.theme = 'light';
    expect(setup.i18n.global.t('chrome.offsetDisplay', { ms: 30 })).toContain('30');
    expect(setup.elementLocale.value.name).toBe('zh-cn');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    stopAppearance();
    setup.stop();
    disposePinia(instance);
  });
});

describe('translation schema', () => {
  it('preserves every existing key and placeholder across all four dictionaries', () => {
    for (const dictionary of [zh, ja, ko]) expect(validateMessages(en, dictionary)).toEqual([]);
  });
  it('reports missing keys and changed placeholders', () => {
    expect(validateMessages({ greeting: 'Hi {name}' }, { greeting: 'Hi {other}' })).toEqual([
      'greeting: placeholders differ',
    ]);
    expect(validateMessages({ greeting: 'Hi' }, {})).toEqual(['greeting: missing']);
  });
});
