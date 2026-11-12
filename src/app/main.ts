import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import { localization, pinia } from './runtime';
import App from './App.vue';

const application = createApp(App);
application.use(pinia);
application.use(localization.i18n);
application.use(ElementPlus);
application.mount('#app');
