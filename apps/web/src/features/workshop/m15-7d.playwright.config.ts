import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'm15-7d.profile-lifecycle.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5182', channel: 'msedge', headless: true, acceptDownloads: true },
  webServer: {
    command: 'pnpm --filter @shoushang/web exec vite --config testing/m15-7d.vite.config.ts --host 127.0.0.1 --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
