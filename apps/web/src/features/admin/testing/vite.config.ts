import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 5193, strictPort: true, proxy: { '/api': 'http://127.0.0.1:31393' } }, build: { outDir: process.env.M13_TEST_WEB_DIST ?? resolve('apps/web/src/features/admin/testing/.build'), emptyOutDir: false, rollupOptions: { input: resolve('apps/web/src/features/admin/testing/index.html') } } });
