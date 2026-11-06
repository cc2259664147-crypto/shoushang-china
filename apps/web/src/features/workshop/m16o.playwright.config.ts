import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const web = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  testDir: '.', testMatch: 'm16o-showcase.case.ts', workers: 1, timeout: 90_000,
  projects: [{ name: 'desktop' }, { name: 'mobile' }],
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'msedge', headless: true },
  webServer: [
    { command: 'pnpm exec tsx apps/api/testing/m16o-server.ts', cwd: root, url: 'http://127.0.0.1:31877/health', timeout: 30_000, reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort', cwd: web, env: { API_PROXY_TARGET: 'http://127.0.0.1:31877' }, url: 'http://127.0.0.1:5173/', timeout: 30_000, reuseExistingServer: false },
  ],
});
