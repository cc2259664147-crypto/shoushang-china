import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
const root = process.env.M14_5_DATA_ROOT!, evidence = process.env.M14_5_EVIDENCE!;
if (!root?.includes('m14-4-') || !evidence?.includes('m14-5-final-acceptance')) throw new Error('Explicit M14-5 isolated roots required');
export default defineConfig({ testDir: '.', testMatch: 'final-candidate-performance.spec.ts', workers: 1, retries: 0, timeout: 300000, outputDir: join(evidence, 'results'), reporter: [['list'], ['json', { outputFile: join(evidence, 'report.json') }]], use: { baseURL: 'http://127.0.0.1:5215', channel: 'chrome', headless: true }, webServer: [
  { command: 'node apps/api/dist/server.js', url: 'http://127.0.0.1:31415/ready', env: { CONTENT_DATABASE_PATH: join(root, 'content.sqlite'), ADMIN_MEDIA_ROOT: join(root, 'media'), ADMIN_BACKUP_ROOT: join(root, 'backups'), ADMIN_ENABLED: '1', ADMIN_ORIGIN: 'http://127.0.0.1:5215', ADMIN_SECURITY_MODE: 'loopback-http', HOST: '127.0.0.1', PORT: '31415' }, reuseExistingServer: false, cwd: resolve('.') },
  { command: 'pnpm --filter @shoushang/web exec vite preview --host 127.0.0.1 --port 5215 --strictPort', url: 'http://127.0.0.1:5215', env: { API_PROXY_TARGET: 'http://127.0.0.1:31415' }, reuseExistingServer: false, cwd: resolve('.') },
] });
