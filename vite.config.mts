import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueI18n from '@intlify/unplugin-vue-i18n/vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(root, 'src/app'),
  base: './',
  plugins: [
    vue(),
    VueI18n({
      include: ['en', 'zh', 'ja', 'ko'].map(language => resolve(root, `src/i18n/${language}.json`)),
      runtimeOnly: true,
      compositionOnly: true,
      dropMessageCompiler: true,
    }),
  ],
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: {
    outDir: resolve(root, 'dist/app'),
    emptyOutDir: true,
    sourcemap: 'hidden',
    target: 'es2022',
    manifest: true,
  },
  worker: { format: 'es' },
});
