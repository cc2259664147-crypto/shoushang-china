// Explicit post-build verification driver. Child runs plain Node and the built server only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ContentDatabase } from '../src/database';
import { developmentData } from '../src/database/development';

const root = mkdtempSync(join(tmpdir(), 'm12-built-'));
const databasePath = join(root, 'content.sqlite');
const entry = resolve('apps/api/dist/server.js');
const bundle = readFileSync(entry, 'utf8');
assert.doesNotMatch(bundle, /@shoushang\/fixtures|test-server\.ts|--import.*tsx/);
const seed = new ContentDatabase({ path: databasePath }); seed.initializeDevelopment(developmentData); seed.close();
async function launch(direct: boolean, action: 'close' | 'SIGINT' | 'SIGTERM' = 'close') {
  const driver = `const {startServer}=await import(${JSON.stringify(pathToFileURL(entry).href)});const app=await startServer();process.once('message',async()=>{${action === 'close' ? '' : `process.emit('${action}');`}await app.close();process.disconnect();});`;
  const child = spawn(process.execPath, direct ? [entry] : ['--input-type=module', '-e', driver], {
    cwd: root, env: { ...process.env, NODE_OPTIONS: '', CONTENT_DATABASE_PATH: databasePath, PORT: '0' }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  if (!child.stdout || !child.stderr) throw new Error('Child output pipes required');
  const output = child.stdout;
  let errors = ''; child.stderr.on('data', data => { errors += String(data); });
  try {
    const address = await new Promise<string>((done, reject) => {
      let text = ''; const timer = setTimeout(() => reject(new Error('Built server startup timeout')), 10000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Built server exited ${code}: ${errors}`)); });
      output.on('data', data => { text += String(data); const match = /API: (http:\/\/[^\s]+)/.exec(text); if (match?.[1]) { clearTimeout(timer); done(match[1]); } });
    });
    const health = await fetch(`${address}/health`); assert.equal(health.status, 200); assert.equal((await health.json()).contentMode, 'http');
    const ready = await fetch(`${address}/ready`); assert.equal(ready.status, 200);
    const templates = await (await fetch(`${address}/api/v1/templates?craftId=craft-papercut`)).json(); assert.equal(templates.value.total, 1); assert.equal(templates.value.items[0].id, 'template-dev-paper');
    const ended = once(child, 'exit');
    if (direct) child.kill(); else child.send('stop');
    const exit = await ended; if (!direct) assert.equal(exit[0], 0);
    return { directEntry: direct, shutdown: direct ? 'owned process terminated after direct-entry smoke (Windows kill is forced)' : action, httpVerified: true, persistedTemplate: 'template-dev-paper' };
  } finally { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } }
}
try {
  const results = [];
  for (const signal of ['close', 'SIGINT', 'SIGTERM'] as const) results.push(await launch(false, signal));
  results.push(await launch(true));
  console.log(JSON.stringify({ node: process.version, performedAt: new Date().toISOString(), builtBundle: entry, childUsesTsxOrFixtures: false, independentCwd: true, gracefulSignalsExercisedByProcessEmit: true, realOsControlSignalDeliveryVerified: false, results }, null, 2));
} finally {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected temporary directory');
  rmSync(root, { recursive: true, force: true });
}
