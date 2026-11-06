import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(root) || !statSync(root).isDirectory()) throw new Error('请提供已解压包目录');
const manifest = JSON.parse(readFileSync(join(root, 'DELIVERY-MANIFEST.json'), 'utf8'));
function walk(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`发现符号链接：${rel}`);
    if (entry.isDirectory()) files.push(...walk(join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files.sort();
}
const expected = new Map(manifest.files.map((item) => [item.path, item]));
const actual = walk(root).filter((item) => item !== 'DELIVERY-MANIFEST.json');
const editorBatch = String(manifest.batch ?? '').startsWith('v1-editor-');
const errors = [];
const forbiddenParts = new Set(['.git', 'node_modules', '.pnpm-store', '.pnpm-cache', 'dist', 'evidence', 'testing', 'test-results', 'playwright-report']);
const testName = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/u;
const testDriverName = /^m15-7[a-z]?\./u;
const testEntryName = /(?:^|[-_.])testing(?:$|[-_.])/u;
const playwrightConfigName = /playwright\.config\./u;
for (const path of actual) {
  if (path.includes('..') || path.startsWith('/') || /^[A-Za-z]:/u.test(path)) errors.push(`非法路径：${path}`);
  const name = basename(path);
  const parts = path.split('/');
  if (parts[0] === 'delivery') errors.push(`禁止旧 delivery 目录：${path}`);
  if (parts.some((part) => forbiddenParts.has(part))) errors.push(`禁止缓存/测试目录：${path}`);
  if (testName.test(name) || testDriverName.test(name)) errors.push(`禁止测试代码：${path}`);
  // 旧 v1-initial 包按历史行为保留 testing 入口与 Playwright 配置；编辑器候选一律禁止。
  if (editorBatch && (testEntryName.test(name) || playwrightConfigName.test(name))) {
    errors.push(`禁止测试入口或 Playwright 配置：${path}`);
  }
  const item = expected.get(path);
  if (!item) { errors.push(`清单外文件：${path}`); continue; }
  const file = join(root, path);
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (digest !== item.sha256 || statSync(file).size !== item.bytes) errors.push(`哈希或大小不符：${path}`);
  expected.delete(path);
}
for (const missing of expected.keys()) errors.push(`缺少文件：${missing}`);
for (const path of actual) if (['.sqlite', '.db', '.wal', '.shm', '.log', '.map'].includes(extname(path).toLowerCase())) errors.push(`禁止扩展名：${path}`);
if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write(`${JSON.stringify({ ok: true, root, files: actual.length, kind: manifest.kind, batch: manifest.batch }, null, 2)}\n`);
