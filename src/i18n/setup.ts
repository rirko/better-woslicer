import { computed, watch } from 'vue';
import { createI18n } from 'vue-i18n';
import type { Pinia } from 'pinia';
import enLocale from 'element-plus/es/locale/lang/en';
import zhLocale from 'element-plus/es/locale/lang/zh-cn';
import jaLocale from 'element-plus/es/locale/lang/ja';
import koLocale from 'element-plus/es/locale/lang/ko';
import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';
import ko from './ko.json';
import { DOC_LANG } from '../core/language';
import { useUiPreferencesStore, type PreferenceOptions } from '../ui/preferences';
import type { Platform } from '../platform/contracts';

export function setupI18n(pinia: Pinia, options: PreferenceOptions = {}) {
  const preferences = useUiPreferencesStore(pinia);
  preferences.initialize(options);
  const i18n = createI18n({ legacy: false, locale: preferences.resolvedLanguage, fallbackLocale: 'en', messages: { en, zh, ja, ko } });
  const locales = { en: enLocale, zh: zhLocale, ja: jaLocale, ko: koLocale };
  const elementLocale = computed(() => locales[preferences.resolvedLanguage]);
  const stopLocale = watch(() => preferences.resolvedLanguage, value => { i18n.global.locale.value = value; }, { flush: 'sync' });
  const appearanceStops = new Set<() => void>();
  function syncAppearance(platform?: Pick<Platform, 'setTheme'>, onError: (error: unknown) => void = console.error): () => void {
    const stopTheme = watch(() => preferences.theme, theme => {
      if (typeof document !== 'undefined') {
        const root = document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
      }
      void platform?.setTheme(theme).catch(onError);
    }, { immediate: true, flush: 'sync' });
    const stopLanguage = watch(() => preferences.resolvedLanguage, language => {
      if (typeof document !== 'undefined') document.documentElement.lang = DOC_LANG[language];
    }, { immediate: true, flush: 'sync' });
    const stop = () => { stopTheme(); stopLanguage(); };
    appearanceStops.add(stop);
    return () => { stop(); appearanceStops.delete(stop); };
  }
  function stop(): void { stopLocale(); for (const cleanup of appearanceStops) cleanup(); appearanceStops.clear(); }
  return { i18n, elementLocale, syncAppearance, stop };
}
