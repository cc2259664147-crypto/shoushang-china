// Explicit isolated verification only. No production startup import.
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { crafts, exhibits, stories, templates } from '@shoushang/fixtures';
import { StorySchema } from '@shoushang/contracts';
import { ContentDatabase } from '../database';
import { PublicContentService } from './index';

if (process.argv[2] === '--run-isolated-drill') {
  const root = mkdtempSync(join(tmpdir(), 'shoushang-m12-restore-'));
  const sourcePath = join(root, 'source', 'content.sqlite'), backupPath = join(root, 'backup', 'snapshot.sqlite'), restoredPath = join(root, 'restored', 'content.sqlite');
  const source = new ContentDatabase({ path: sourcePath });
  let restored: ContentDatabase | undefined;
  try {
    for (const [kind, rows] of [['craft', crafts], ['template', templates], ['exhibit', exhibits], ['story', stories]] as const) for (const row of rows) {
      const revision = source.createRevision(kind, row, null, 'restore-test'); source.submit(kind, row.id, revision, 'restore-test'); source.publish(kind, row.id, revision, null, 'restore-test');
    }
    const story = StorySchema.parse(stories[0]);
    source.createRevision('story', { ...story, title: '开发恢复演练：未公开草稿' }, 1, 'restore-test');
    source.unpublish('template', 'template-dev-square', 1, 'restore-test');
    source.revokeMedia('media-dev-unreferenced', 'restore-test');
    const before = new PublicContentService(source).snapshot();
    const query = new PublicContentService(source).listExhibits({ q: '几何', tag: '占位', page: 1, pageSize: 12 });
    source.backup(backupPath); // Live WAL database -> SQLite-managed consistent backup.
    const hash = createHash('sha256').update(readFileSync(backupPath)).digest('hex');
    mkdirSync(dirname(restoredPath), { recursive: true }); copyFileSync(backupPath, restoredPath);
    restored = new ContentDatabase({ path: restoredPath });
    const after = new PublicContentService(restored).snapshot();
    if (!isDeepStrictEqual(source.readPublicSnapshot().revokedMedia, restored.readPublicSnapshot().revokedMedia)) throw new Error('Restored media revocation mismatch');
    if (!isDeepStrictEqual(before, after) || !isDeepStrictEqual(query, new PublicContentService(restored).listExhibits({ q: '几何', tag: '占位', page: 1, pageSize: 12 }))) throw new Error('Restored public query mismatch');
    const raw = new DatabaseSync(restoredPath);
    let states: unknown, integrity: unknown, foreignKeys: unknown;
    try {
      states = raw.prepare('SELECT kind,entity_id,revision,state FROM revisions ORDER BY kind,entity_id,revision').all();
      integrity = raw.prepare('PRAGMA integrity_check').all(); foreignKeys = raw.prepare('PRAGMA foreign_key_check').all();
    } finally { raw.close(); }
    restored.close(); restored = undefined;
    const restart = spawnSync(process.execPath, ['--import', 'tsx', resolve('apps/api/src/content/test-server.ts'), '--m12-inspect', restoredPath], { encoding: 'utf8' });
    if (restart.status !== 0 || !isDeepStrictEqual(JSON.parse(restart.stdout), before)) throw new Error(`Restart verification failed: ${restart.stderr}`);
    console.log(JSON.stringify({
      developmentOnly: true, performedAt: new Date().toISOString(), node: process.version,
      method: 'VACUUM INTO from an open WAL database; copy standalone backup to separate restore directory',
      isolatedDirectories: { source: dirname(sourcePath), backup: dirname(backupPath), restored: dirname(restoredPath) },
      backupSha256: hash, publicIds: { crafts: after.crafts.map(c => c.id), templates: after.templates.map(t => t.id), exhibits: after.exhibits.map(e => e.id), stories: after.stories.map(s => s.id) },
      states, integrity, foreignKeys, query: { total: query.total, ids: query.items.map(e => e.id) },
      publicSnapshotEqual: true, queryEqual: true, independentProcessEqual: true, mediaRevocationEqual: true,
      automaticDailyBackupDeployed: false, mediaFilesBackedUp: false, temporaryDatabaseFilesRemovedOnExit: true,
    }, null, 2));
  } finally {
    restored?.close(); source.close();
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected drill directory');
    rmSync(root, { recursive: true, force: true });
  }
}
