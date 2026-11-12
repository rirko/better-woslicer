import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import VueI18n from '@intlify/unplugin-vue-i18n/vite';

export default defineConfig({
  plugins: [
    vue(),
    VueI18n({
      include: ['en', 'zh', 'ja', 'ko'].map((language) =>
        fileURLToPath(new URL(`./src/i18n/${language}.json`, import.meta.url)),
      ),
      runtimeOnly: true,
      compositionOnly: true,
      dropMessageCompiler: true,
    }),
  ],
  test: {
    environment: 'happy-dom',
    include: [
      'tests/components/**/*.test.ts',
      'tests/app/**/*.test.ts',
      'tests/project/**/*.test.ts',
    ],
    restoreMocks: true,
    clearMocks: true,
  },
});
