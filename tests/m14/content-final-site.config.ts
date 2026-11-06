import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
const dataRoot = process.env.M14_4_DATA_ROOT;
const evidence = process.env.M14_4_SITE_EVIDENCE;
if (!dataRoot?.includes('m14-4-') || !evidence?.includes('m14-4')) throw new Error('M14-4 isolated roots required');
export default defineConfig({
  testDir: '.', testMatch: 'content-final-site.spec.ts', workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 }, outputDir: join(evidence, 'results'),
  reporter: [['list'], ['json', { outputFile: join(evidence, 'browser-report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5204', channel: 'msedge', headless: true },
  webServer: [
    { command: 'node apps/api/dist/server.js', url: 'http://127.0.0.1:31404/ready', env: { CONTENT_DATABASE_PATH: join(dataRoot, 'content.sqlite'), ADMIN_MEDIA_ROOT: join(dataRoot, 'media'), ADMIN_BACKUP_ROOT: join(dataRoot, 'backups'), ADMIN_ENABLED: '1', ADMIN_ORIGIN: 'http://127.0.0.1:5204', ADMIN_SECURITY_MODE: 'loopback-http', HOST: '127.0.0.1', PORT: '31404' }, reuseExistingServer: false, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite preview --host 127.0.0.1 --port 5204 --strictPort', url: 'http://127.0.0.1:5204', env: { API_PROXY_TARGET: 'http://127.0.0.1:31404' }, reuseExistingServer: false, cwd: resolve('.') },
  ],
});
