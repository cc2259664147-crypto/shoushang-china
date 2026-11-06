import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const web = fileURLToPath(new URL('../../../', import.meta.url));
const input = process.env.M16P_CONTENT_ROOT;
if (!input) throw new Error('M16P_CONTENT_ROOT must point to an initialized, isolated temporary content root');
const contentRoot = realpathSync(resolve(input)), rel = relative(realpathSync(tmpdir()), contentRoot);
if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || !existsSync(join(contentRoot, 'v1-initialization.json'))) throw new Error('M16P_CONTENT_ROOT must be an initialized root within the temporary directory');
export default defineConfig({
  testDir: '.', testMatch: 'm16p-formal.case.ts', workers: 1, timeout: 120_000,
  projects: [{ name: 'desktop' }, { name: 'mobile' }],
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'msedge', headless: true },
  webServer: [
    { command: 'node apps/api/dist/server.js', cwd: root, env: { CONTENT_DATABASE_PATH: join(contentRoot, 'content.sqlite'), ADMIN_MEDIA_ROOT: join(contentRoot, 'media'), ADMIN_ENABLED: '0', HOST: '127.0.0.1', PORT: '31878' }, url: 'http://127.0.0.1:31878/health', timeout: 30_000, reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort', cwd: web, env: { API_PROXY_TARGET: 'http://127.0.0.1:31878' }, url: 'http://127.0.0.1:5173/', timeout: 30_000, reuseExistingServer: false },
  ],
});
