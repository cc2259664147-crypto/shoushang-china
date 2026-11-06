import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
const root = process.env.M14_3B_DATA_ROOT;
const evidence = process.env.M14_3B_EVIDENCE;
if (!root || !root.includes('m14-3b-') || !evidence || !evidence.includes('m14-3b')) throw new Error('Fresh M14-3B data and evidence roots required');
export default defineConfig({
  testDir: '.', testMatch: 'template-browser.spec.ts', workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 },
  outputDir: join(evidence, 'results'), reporter: [['list'], ['json', { outputFile: join(evidence, 'browser-report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5203', channel: 'msedge', headless: true, acceptDownloads: true },
  webServer: [
    { command: 'node apps/api/dist/server.js', url: 'http://127.0.0.1:31403/ready', env: { CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), HOST: '127.0.0.1', PORT: '31403', ADMIN_ENABLED: '0' }, reuseExistingServer: false, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite preview --host 127.0.0.1 --port 5203 --strictPort', url: 'http://127.0.0.1:5203', env: { API_PROXY_TARGET: 'http://127.0.0.1:31403' }, reuseExistingServer: false, cwd: resolve('.') },
  ],
});
