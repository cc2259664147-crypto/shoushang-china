import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ContentDatabase } from '../../apps/api/src/database';
import { developmentData } from '../../apps/api/src/database/development';
import { V1_CONTENT_SET_NAME, v1Templates } from './v1-content-set';

const root = resolve('.');
const sandbox = mkdtempSync(join(tmpdir(), 'shoushang-v1-init-'));
const target = join(sandbox, 'content');
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
function initialize(targetRoot: string, projectRoot = root) {
  return spawnSync(process.execPath, ['--import', loader, resolve(root, 'scripts/content/initialize-v1.ts'), '--root', targetRoot], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, timeout: 180000 });
}
function securityState(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try { return {
    enabledAccounts: Number(raw.prepare('SELECT COUNT(*) AS n FROM admin_accounts WHERE disabled=0').get()!.n),
    activeSessions: Number(raw.prepare('SELECT COUNT(*) AS n FROM admin_sessions WHERE revoked=0 AND expires_at>?').get(Date.now())!.n),
  }; } finally { raw.close(); }
}
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
try {
  const first = initialize(target);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const receipt = JSON.parse(readFileSync(join(target, 'v1-initialization.json'), 'utf8')) as { status: string; counts: Record<string, number> };
  assert.equal(receipt.status, 'complete');
  assert.deepEqual(receipt.counts, { templates: 3, exhibits: 12, stories: 3, media: 15 });
  assert.deepEqual(securityState(join(target, 'content.sqlite')), { enabledAccounts: 0, activeSessions: 0 });
  const beforeRepeat = hash(readFileSync(join(target, 'content.sqlite')));
  const second = initialize(target);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal((JSON.parse(second.stdout) as { unchanged: boolean }).unchanged, true);
  assert.equal(hash(readFileSync(join(target, 'content.sqlite'))), beforeRepeat, 'A repeated initializer must not migrate or write the database');
  const maintained = new ContentDatabase({ path: join(target, 'content.sqlite') });
  try { maintained.createRevision('template', { ...v1Templates[0], version: 2, name: '用户后续维护，初始化不得覆盖' }, 1, 'delivery-test-maintainer'); } finally { maintained.close(); }
  const beforeMaintainedRepeat = hash(readFileSync(join(target, 'content.sqlite')));
  const maintainedRepeat = initialize(target);
  assert.notEqual(maintainedRepeat.status, 0);
  assert.match(maintainedRepeat.stderr, /existing revisions were preserved/u);
  assert.equal(hash(readFileSync(join(target, 'content.sqlite'))), beforeMaintainedRepeat, 'Existing user revision was changed');
  const occupiedTarget = join(sandbox, 'occupied'); const occupiedPath = join(occupiedTarget, 'content.sqlite');
  const occupied = new ContentDatabase({ path: occupiedPath }); try { occupied.initializeDevelopment(developmentData); } finally { occupied.close(); }
  const protectedRun = initialize(occupiedTarget);
  assert.notEqual(protectedRun.status, 0);
  const protectedDb = new ContentDatabase({ path: occupiedPath }); try { assert.equal(protectedDb.readPublicSnapshot().rows.length, 2); } finally { protectedDb.close(); }
  assert.equal(existsSync(join(occupiedTarget, 'v1-initialization.failed.json')), false, 'Refusal must not write into an existing user root');
  assert.notEqual(initialize('relative-root-must-be-refused').status, 0);
  const claimedTarget = join(sandbox, 'claimed-root'); mkdirSync(claimedTarget);
  const claim = JSON.stringify({ contentSet: V1_CONTENT_SET_NAME, processId: 'another-initializer' });
  writeFileSync(join(claimedTarget, '.v1-initializer.lock'), claim);
  assert.notEqual(initialize(claimedTarget).status, 0);
  assert.equal(readFileSync(join(claimedTarget, '.v1-initializer.lock'), 'utf8'), claim, 'Another initializer claim must stay untouched');
  assert.equal(existsSync(join(claimedTarget, 'v1-initialization.failed.json')), false);

  // A corrupt delivery copy exercises both preflight and a real HTTP decoder failure after all five logins.
  // This diagnostic fixture uses isolated copies and dependency junctions only; it is never a delivery package.
  const corruptProject = join(sandbox, 'corrupt-project');
  mkdirSync(join(corruptProject, 'apps/api'), { recursive: true });
  cpSync(join(root, 'apps/api/dist'), join(corruptProject, 'apps/api/dist'), { recursive: true });
  copyFileSync(join(root, 'apps/api/package.json'), join(corruptProject, 'apps/api/package.json'));
  symlinkSync(join(root, 'apps/api/node_modules'), join(corruptProject, 'apps/api/node_modules'), 'junction');
  const recordPath = join('content', V1_CONTENT_SET_NAME, 'records.json');
  const records = JSON.parse(readFileSync(join(root, recordPath), 'utf8')) as { media: Array<{ originalFile: string; uploadFile: string; uploadSha256: string }> };
  for (const item of records.media) for (const file of [item.uploadFile, item.originalFile]) { mkdirSync(dirname(join(corruptProject, file)), { recursive: true }); copyFileSync(join(root, file), join(corruptProject, file)); }
  const manifestPath = 'docs/content/assets/m14-3c/manifest.json';
  mkdirSync(dirname(join(corruptProject, manifestPath)), { recursive: true }); copyFileSync(join(root, manifestPath), join(corruptProject, manifestPath));
  mkdirSync(dirname(join(corruptProject, recordPath)), { recursive: true });
  const brokenMedia = records.media[0]!;
  writeFileSync(join(corruptProject, brokenMedia.uploadFile), 'invalid image, intentionally isolated delivery test');
  writeFileSync(join(corruptProject, recordPath), JSON.stringify(records));
  const preflightTarget = join(sandbox, 'preflight-refusal');
  const preflight = initialize(preflightTarget, corruptProject);
  assert.notEqual(preflight.status, 0); assert.match(preflight.stderr, /media hash/u);
  assert.equal(existsSync(preflightTarget), false, 'Preflight must not create a partial private root');
  brokenMedia.uploadSha256 = hash(readFileSync(join(corruptProject, brokenMedia.uploadFile)));
  writeFileSync(join(corruptProject, recordPath), JSON.stringify(records));
  const failedTarget = join(sandbox, 'http-failure');
  const failed = initialize(failedTarget, corruptProject);
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /upload failed/u);
  assert.equal(existsSync(join(failedTarget, 'v1-initialization.json')), false);
  assert.equal(existsSync(join(failedTarget, '.v1-initializer-server.mjs')), false);
  const failure = JSON.parse(readFileSync(join(failedTarget, 'v1-initialization.failed.json'), 'utf8')) as { status: string; cleanupErrors: string[] };
  assert.equal(failure.status, 'failed'); assert.deepEqual(failure.cleanupErrors, []);
  assert.deepEqual(securityState(join(failedTarget, 'content.sqlite')), { enabledAccounts: 0, activeSessions: 0 });
  const failedState = hash(readFileSync(join(failedTarget, 'content.sqlite')));
  const failedAgain = initialize(failedTarget, corruptProject);
  assert.notEqual(failedAgain.status, 0); assert.match(failedAgain.stderr, /existing or incomplete content root/u);
  assert.equal(hash(readFileSync(join(failedTarget, 'content.sqlite'))), failedState);
  process.stdout.write(`${JSON.stringify({ ok: true, firstRun: receipt.counts, repeatRun: 'unchanged-and-read-only', existingRevision: 'refused-and-preserved', occupiedDatabase: 'refused-and-unchanged', badHash: 'refused-before-root-creation', httpDecoderFailure: 'failed-with-recovery-record-and-cleanup', partialRepeat: 'refused-and-unchanged', enabledAccounts: 0, activeSessions: 0 }, null, 2)}\n`);
} finally {
  const resolvedSandbox = resolve(sandbox); const resolvedTemp = resolve(tmpdir());
  const tempRelative = relative(resolvedTemp, resolvedSandbox);
  if (tempRelative && tempRelative !== '..' && !tempRelative.startsWith(`..${sep}`) && tempRelative.startsWith('shoushang-v1-init-')) rmSync(resolvedSandbox, { recursive: true, force: true });
}
