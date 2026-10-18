import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', timeout: 45000, expect: { timeout: 8000 }, use: { baseURL: 'http://127.0.0.1:5173', channel: 'msedge', headless: true }, webServer: { command: 'pnpm --filter @shoushang/web dev', url: 'http://127.0.0.1:5173/workshop/papercut', reuseExistingServer: true, timeout: 30000 } });
