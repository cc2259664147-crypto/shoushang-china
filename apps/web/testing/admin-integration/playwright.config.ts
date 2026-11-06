import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
const root = process.env.M13_INTEGRATION_ROOT;
if (!root) throw new Error('Explicit M13 isolated root required');
export default defineConfig({
  testDir: '.', testMatch: 'normal-app.spec.ts', workers: 1, timeout: 90000, expect: { timeout: 12000 },
  outputDir: join(root, 'browser-results'), reporter: [['list'], ['json', { outputFile: join(root, 'browser-report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5194', channel: 'msedge', headless: true },
  webServer: [
    { command: 'pnpm exec tsx apps/api/src/server.ts', url: 'http://127.0.0.1:31394/ready', env: { CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), HOST: '127.0.0.1', PORT: '31394', ADMIN_ENABLED: '1', ADMIN_SECURITY_MODE: 'loopback-http', ADMIN_ORIGIN: 'http://127.0.0.1:5194', ADMIN_MEDIA_ROOT: join(root, 'media'), ADMIN_BACKUP_ROOT: join(root, 'backups') }, reuseExistingServer: false, timeout: 30000, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite --host 127.0.0.1 --port 5194 --strictPort', url: 'http://127.0.0.1:5194/admin', env: { API_PROXY_TARGET: 'http://127.0.0.1:31394' }, reuseExistingServer: false, timeout: 30000, cwd: resolve('.') },
  ],
});
