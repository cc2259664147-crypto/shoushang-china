import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';

const root = process.env.M14_3B_DATA_ROOT;
const evidence = process.env.M14_3C_EVIDENCE;
if (!root?.includes('m14-3b-') || !evidence?.includes('m14-3c-teaching-')) throw new Error('Fresh isolated M14-3C roots required');

export default defineConfig({
  testDir: '.', testMatch: 'template-teaching.spec.ts', workers: 1, retries: 0, maxFailures: 1,
  timeout: 90000, expect: { timeout: 15000 },
  outputDir: join(evidence, 'results'), reporter: [['list'], ['json', { outputFile: join(evidence, 'browser-report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5204', channel: 'msedge', headless: true, acceptDownloads: true },
  webServer: [
    { command: 'node apps/api/dist/server.js', url: 'http://127.0.0.1:31404/ready', env: { CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), HOST: '127.0.0.1', PORT: '31404', ADMIN_ENABLED: '0' }, reuseExistingServer: false, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite preview --host 127.0.0.1 --port 5204 --strictPort', url: 'http://127.0.0.1:5204', env: { API_PROXY_TARGET: 'http://127.0.0.1:31404' }, reuseExistingServer: false, cwd: resolve('.') },
  ],
});
