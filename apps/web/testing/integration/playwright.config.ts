import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const root = process.env.M12_INTEGRATION_ROOT;
if (!root) throw new Error('M12_INTEGRATION_ROOT must name a NEW isolated test directory');
const database = resolve(root, 'content.sqlite');
export default defineConfig({
  testDir: '.', testMatch: 'application.spec.ts', workers: 1, timeout: 60000, expect: { timeout: 12000 },
  outputDir: resolve(root, 'browser-results'), reporter: [['list'], ['json', { outputFile: resolve(root, 'browser-report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5189', channel: 'msedge', headless: true },
  webServer: [
    { command: 'pnpm exec tsx apps/api/src/server.ts', url: 'http://127.0.0.1:31389/ready', env: { CONTENT_DATABASE_PATH: database, PORT: '31389' }, reuseExistingServer: false, timeout: 30000, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite --host 127.0.0.1 --port 5189 --strictPort', url: 'http://127.0.0.1:5189', env: { API_PROXY_TARGET: 'http://127.0.0.1:31389' }, reuseExistingServer: false, timeout: 30000, cwd: resolve('.') },
  ],
});
