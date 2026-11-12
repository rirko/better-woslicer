import { createPinia } from 'pinia';
import { setupI18n } from '../i18n/setup';

export const pinia = createPinia();
export const localization = setupI18n(pinia);
