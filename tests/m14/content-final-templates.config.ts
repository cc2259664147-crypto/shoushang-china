import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
const root = process.env.M14_3B_DATA_ROOT;
const evidence = process.env.M14_3B_EVIDENCE;
if (!root?.includes('m14-4-') || !evidence?.includes('m14-4')) throw new Error('M14-4 roots required');
export default defineConfig({
  testDir: '.', testMatch: 'template-browser.spec.ts', grep: /c0[123]:/, workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 }, outputDir: join(evidence, 'results'), reporter: [['list'], ['json', { outputFile: join(evidence, 'browser-report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5205', channel: 'msedge', headless: true, acceptDownloads: true },
  webServer: [
    { command: 'node apps/api/dist/server.js', url: 'http://127.0.0.1:31405/ready', env: { CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), ADMIN_MEDIA_ROOT: join(root, 'media'), ADMIN_BACKUP_ROOT: join(root, 'backups'), ADMIN_ENABLED: '1', ADMIN_ORIGIN: 'http://127.0.0.1:5205', ADMIN_SECURITY_MODE: 'loopback-http', HOST: '127.0.0.1', PORT: '31405' }, reuseExistingServer: false, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite preview --host 127.0.0.1 --port 5205 --strictPort', url: 'http://127.0.0.1:5205', env: { API_PROXY_TARGET: 'http://127.0.0.1:31405' }, reuseExistingServer: false, cwd: resolve('.') },
  ],
});
