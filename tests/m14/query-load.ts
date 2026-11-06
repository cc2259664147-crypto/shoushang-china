import { ContentDatabase } from '../../apps/api/src/database';
import { developmentData } from '../../apps/api/src/database/development';
import { exhibits } from '@shoushang/fixtures';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
async function main() {
const evidence = resolve(process.argv[2] ?? 'docs/qa/evidence/m14-1/query'); mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'm14-query-')), database = join(root, 'content.sqlite');
const db = new ContentDatabase({ path: database });
try {
  db.initializeDevelopment(developmentData);
  for (let i = 0; i < 1000; i++) {
    const row = { ...exhibits[0]!, id: `m14-load-${i}`, title: `自动化fixture ${i}`, storyIds: [], templateIds: ['template-dev-paper'], sortOrder: i };
    const revision = db.createRevision('exhibit', row, null, 'm14-isolated-load');
    db.submit('exhibit', row.id, revision, 'm14-isolated-load'); db.publish('exhibit', row.id, revision, null, 'm14-isolated-load');
  }
} finally { db.close(); }
const wrapper = join(root, 'server.mjs');
writeFileSync(wrapper, `import {startServer} from ${JSON.stringify(pathToFileURL(resolve('apps/api/dist/server.js')).href)};const app=await startServer();process.stdin.resume();process.stdin.once('end',()=>void app.close().then(()=>process.exit(0)));`);
const child = spawn(process.execPath, [wrapper], { env: { ...process.env, CONTENT_DATABASE_PATH: database, HOST: '127.0.0.1', PORT: '0', ADMIN_ENABLED: '0' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const origin = await new Promise<string>((yes, no) => { let output = ''; const timer = setTimeout(() => no(new Error('Startup deadline')), 20000); child.stdout.on('data', (data: Buffer) => { output += data.toString(); const match = /API: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output); if (match) { clearTimeout(timer); yes(match[1]!); } }); child.on('error', no); });
const samples: { worker: number; offset: number; milliseconds: number; status: number; valid: boolean }[] = [];
const started = performance.now(), duration = 300000;
try {
  await Promise.all(Array.from({ length: 20 }, async (_, worker) => {
    let iteration = 0;
    while (performance.now() - started < duration) {
      const start = performance.now(); let status = 0, valid = false;
      try {
        const response = await fetch(`${origin}/api/v1/exhibits?page=${(iteration++ % 84) + 1}&pageSize=12`, { signal: AbortSignal.timeout(10000) });
        status = response.status;
        const body = await response.json() as { ok?: boolean; value?: { total?: number; items?: unknown[] } };
        valid = status === 200 && body.ok === true && body.value?.total === 1000 && Array.isArray(body.value.items);
      } catch { /* Retain failures as samples; never discard errors from denominator. */ }
      samples.push({ worker, offset: start - started, milliseconds: performance.now() - start, status, valid });
    }
  }));
  const elapsed = performance.now() - started, sorted = samples.map(s => s.milliseconds).sort((a, b) => a - b), errors = samples.filter(s => !s.valid).length;
  writeFileSync(join(evidence, 'samples.jsonl'), samples.map(s => JSON.stringify(s)).join('\n') + '\n');
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ node: process.version, os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), dataset: '1000 explicit synthetic developmentOnly fixtures in a new SQLite database', service: 'ordinary Node production API bundle, loopback HTTP, no network shaping; mixed 84 pages, OS cache warm after setup; no browser/CPU throttling applies to this server-only profile', concurrency: 20, requestedDurationMs: duration, elapsedMs: elapsed, count: samples.length, errors, errorRate: errors / samples.length, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], method: '20 closed-loop clients; request start through full response JSON body validation; nearest-rank P95, all failures counted; one required 5-minute run' }, null, 2));
} finally {
  const done = new Promise<void>(yes => child.once('exit', () => yes())); child.stdin.end(); await done;
}
}
void main().catch(() => { process.stderr.write('Isolated query load failed; no credentials logged\n'); process.exitCode = 1; });
