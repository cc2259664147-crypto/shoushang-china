import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
const root = process.env.M14_DATA_ROOT!, evidence = process.env.M14_EVIDENCE!;
if (!root || !evidence) throw new Error('Explicit isolated paths required');
export default defineConfig({ testDir: '.', testMatch: 'performance.spec.ts', workers: 1, retries: 0, timeout: 180000,
  outputDir: join(evidence, 'results'), reporter: [['list'], ['json', { outputFile: join(evidence, 'report.json') }]],
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: 'node apps/api/dist/server.js', url: 'http://127.0.0.1:31398/ready', env: { CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), HOST: '127.0.0.1', PORT: '31398', ADMIN_ENABLED: '0' }, reuseExistingServer: false, cwd: resolve('.') },
    { command: 'pnpm --filter @shoushang/web exec vite preview --host 127.0.0.1 --port 5198 --strictPort', url: 'http://127.0.0.1:5198', env: { API_PROXY_TARGET: 'http://127.0.0.1:31398' }, reuseExistingServer: false, cwd: resolve('.') },
  ],
});
