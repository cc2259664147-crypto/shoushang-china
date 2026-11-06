import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { prepareAdminIntegration } from './prepare-admin-integration';

const evidence = resolve(process.argv[2] ?? 'docs/api/evidence/m13-integration-20261019/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'm13-normal-app-'));
const password = randomBytes(32).toString('base64url');
await prepareAdminIntegration(root, password);
await sharp({ create: { width: 900, height: 700, channels: 3, background: '#a3252c' } }).png().toFile(join(root, 'sample.png'));
const pnpm = process.env.npm_execpath ?? join(dirname(dirname(process.execPath)), 'node_modules/pnpm/bin/pnpm.mjs');
const child = spawn(process.execPath, [pnpm, 'exec', 'playwright', 'test', '--config', 'apps/web/testing/admin-integration/playwright.config.ts'], {
  env: { ...process.env, M13_INTEGRATION_ROOT: root, M13_INTEGRATION_PASSWORD: password, M13_INTEGRATION_EVIDENCE: evidence },
  stdio: 'inherit', windowsHide: true,
});
child.on('exit', code => { process.stdout.write(`Isolated M13 normal-app data: ${root}\n`); process.exitCode = code ?? 1; });
