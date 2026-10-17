import { defineConfig } from '@playwright/test';
// M14 will add core flow tests. No browser download or empty acceptance claim in M01.
export default defineConfig({ testDir: './tests/e2e', use: { baseURL: 'http://127.0.0.1:5173' } });
