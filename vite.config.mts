import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueI18n from '@intlify/unplugin-vue-i18n/vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// The Tauri frontend needs the ipc custom protocol in connect-src for the
// fetch-based IPC transport; the browser release keeps the strict 'none'.
const tauriFrontend = process.env.WOSLICER_TAURI_FRONTEND === '1';
const tauriIpcCsp: Plugin = {
  name: 'tauri-ipc-csp',
  transformIndexHtml(html) {
    if (!tauriFrontend) return html;
    return html.replace("connect-src 'none'", "connect-src 'self' ipc: http://ipc.localhost");
  },
};

export default defineConfig({
  root: resolve(root, 'src/app'),
  base: './',
  plugins: [
    vue(),
    VueI18n({
      include: ['en', 'zh', 'ja', 'ko'].map((language) =>
        resolve(root, `src/i18n/${language}.json`),
      ),
      runtimeOnly: true,
      compositionOnly: true,
      dropMessageCompiler: true,
    }),
    tauriIpcCsp,
  ],
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: {
    outDir: resolve(root, tauriFrontend ? 'dist/app-tauri' : 'dist/app'),
    emptyOutDir: true,
    sourcemap: 'hidden',
    target: 'es2022',
    manifest: true,
  },
  worker: { format: 'es' },
});
