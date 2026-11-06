import { defineConfig } from '@playwright/test';
import { resolve, join } from 'node:path';
const root = process.env.M14_DATA_ROOT;
const evidence = process.env.M14_EVIDENCE;
if (!root || !evidence) throw new Error('New isolated data root and evidence directory required');
export default defineConfig({
  testDir: '.', testMatch: 'acceptance.spec.ts', workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 12000 },
  outputDir: join(evidence, 'results'), reporter: [['list'], ['json', { outputFile: join(evidence, 'report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5197', channel: 'msedge', headless: true },
  webServer: [
    { command: 'pnpm exec tsx apps/api/src/server.ts', url: 'http://127.0.0.1:31397/ready', env: { CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), HOST: '127.0.0.1', PORT: '31397', ADMIN_ENABLED: '0' }, reuseExistingServer: false, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite --host 127.0.0.1 --port 5197 --strictPort', url: 'http://127.0.0.1:5197', env: { API_PROXY_TARGET: 'http://127.0.0.1:31397' }, reuseExistingServer: false, cwd: resolve('.') },
  ],
});
