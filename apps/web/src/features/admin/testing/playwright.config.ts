import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const root = process.env.M13_TEST_ROOT, evidence = process.env.M13_TEST_EVIDENCE;
if (!root || !evidence || !process.env.M13_TEST_PASSWORD)
    throw new Error('Use the isolated M13 browser runner');
export default defineConfig({ testDir: '.', testMatch: 'admin.spec.ts', workers: 1, timeout: 60000, expect: { timeout: 10000 }, outputDir: resolve(root, 'results'), reporter: [['list'], ['json', { outputFile: resolve(evidence, 'browser-report.json') }]], use: { baseURL: 'http://127.0.0.1:5193', channel: 'msedge', headless: true, trace: 'off', screenshot: 'off' }, webServer: [{ command: 'pnpm exec tsx apps/api/src/admin/testing/server.ts --isolated-admin-server', url: 'http://127.0.0.1:31393/test-ready', cwd: resolve('.'), reuseExistingServer: false, timeout: 30000 }, { command: 'pnpm exec vite --config apps/web/src/features/admin/testing/vite.config.ts', url: 'http://127.0.0.1:5193/src/features/admin/testing/index.html', cwd: resolve('.'), reuseExistingServer: false, timeout: 30000 }] });
