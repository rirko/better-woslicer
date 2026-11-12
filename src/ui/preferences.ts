import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { usePreferredDark } from '@vueuse/core';
import { detectLanguage, isLanguage, type Language } from '../core/language';

export type Theme = 'light' | 'dark';
export type LanguageChoice = Language | 'auto';
export interface PreferenceOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  locales?: readonly string[];
  prefersDark?: () => boolean;
}

export const useUiPreferencesStore = defineStore('ui-preferences', () => {
  const systemDark = usePreferredDark();
  const theme = ref<Theme>('dark');
  const language = ref<LanguageChoice>('auto');
  const locales = ref<readonly string[]>([]);
  const resolvedLanguage = computed(() =>
    language.value === 'auto' ? detectLanguage(locales.value) : language.value,
  );
  let initialized = false;
  let storage: PreferenceOptions['storage'] = null;
  function persist(): void {
    try {
      storage?.setItem('woslicer.theme', theme.value);
      if (language.value === 'auto') storage?.removeItem('woslicer.language');
      else storage?.setItem('woslicer.language', language.value);
    } catch {
      /* Private browsing may deny persistence; in-memory choices still work. */
    }
  }
  watch(
    [theme, language],
    () => {
      if (initialized) persist();
    },
    { flush: 'sync' },
  );
  function initialize(options: PreferenceOptions = {}): void {
    if (initialized) return;
    try {
      storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    } catch {
      storage = null;
    }
    locales.value =
      options.locales ?? (typeof navigator === 'undefined' ? [] : navigator.languages);
    let savedTheme: string | null = null;
    let savedLanguage: string | null = null;
    try {
      savedTheme = storage?.getItem('woslicer.theme') ?? null;
      savedLanguage = storage?.getItem('woslicer.language') ?? null;
    } catch {
      /* unavailable */
    }
    const dark = options.prefersDark ?? (() => systemDark.value);
    theme.value =
      savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : dark() ? 'dark' : 'light';
    language.value = isLanguage(savedLanguage) ? savedLanguage : 'auto';
    initialized = true;
    persist();
  }
  function setTheme(value: unknown): void {
    if (value === 'light' || value === 'dark') theme.value = value;
  }
  function setLanguage(value: unknown): void {
    if (value === 'auto' || isLanguage(value)) language.value = value;
  }
  return { theme, language, resolvedLanguage, initialize, setTheme, setLanguage };
});
