/** Persistent, isolated normal-app preview. Press Enter or Ctrl+C to stop. */
import { spawn } from 'node:child_process';
import { mkdtemp, open, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const repo = resolve('.');
const required = ['apps/api/dist/server.js', 'apps/web/dist/index.html', 'node_modules/tsx/dist/cli.mjs', 'apps/web/node_modules/vite/bin/vite.js'];
for (const path of required) await readFile(join(repo, path)).catch(() => { throw new Error(`Build/dependency missing: ${path}`); });
const data = await mkdtemp(join(tmpdir(), 'm14-3b-manual-preview-'));
const database = join(data, 'content.sqlite');
const browserDb = `m07-test-m14-3c-manual-${randomUUID()}`;
const apiPort = 31414, webPort = 5214;
for (const port of [apiPort, webPort]) {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); throw new Error(`Port ${port} is occupied`); }
  catch (error) { if (error instanceof Error && error.message.includes('occupied')) throw error; }
}
const init = spawn(process.execPath, [join(repo, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', 'tests/m14/tsconfig.json', 'tests/m14/prepare-templates.ts', database], { cwd: repo, stdio: 'inherit' });
const initCode = await new Promise(resolveCode => init.once('exit', resolveCode));
if (initCode !== 0) throw new Error(`Candidate initialization failed; isolated data retained at ${data}`);
const children = [];
const logs = [];
async function launch(name, args, env, cwd = repo) {
  const log = await open(join(data, `${name}.log`), 'wx');
  logs.push(log);
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  children.push(child);
  return child;
}
await launch('api', ['apps/api/dist/server.js'], { CONTENT_DATABASE_PATH: database, HOST: '127.0.0.1', PORT: String(apiPort), ADMIN_ENABLED: '0' });
await launch('web', [join(repo, 'apps/web/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` }, join(repo, 'apps/web'));
async function ready(url) {
  for (let n = 0; n < 100; n++) {
    if (children.some(child => child.exitCode !== null)) throw new Error('Preview service exited; inspect logs in isolated data directory');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* startup */ }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`Preview readiness failed: ${url}`);
}
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill(); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  await ready(`http://127.0.0.1:${apiPort}/ready`);
  await ready(`http://127.0.0.1:${webPort}/`);
  const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/templates`);
  const payload = await response.json();
  const body = JSON.stringify(payload);
  for (const id of ['template-dev-c01', 'template-dev-c02', 'template-dev-c03']) if (!body.includes(id)) throw new Error(`Missing candidate ${id}`);
  console.log(`Manual preview: http://127.0.0.1:${webPort}/?m07db=${browserDb}`);
  console.log(`API: http://127.0.0.1:${apiPort}/ready`);
  console.log(`Isolated data (retained after stop): ${data}`);
  console.log('Open the URL only in a fresh private browser context. Press Enter or Ctrl+C here to stop both services.');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(done => { input.once('line', done); process.once('SIGINT', done); process.once('SIGTERM', done); });
  input.close();
} finally {
  stop();
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(done => child.once('exit', done))));
  await Promise.all(logs.map(log => log.close()));
  console.log(`Stopped. Isolated data retained: ${data}`);
}
