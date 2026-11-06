/** Read-only verification of an initializer-owned receipt; never migrates or repairs a database. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type InitializationMapping = {
  candidate: string;
  mediaId?: string;
  mediaRevision?: number;
  kind?: 'exhibit' | 'story';
  contentId?: string;
  revision?: number;
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function inspectInitializedState(databasePath: string, mediaRoot: string, mappings: InitializationMapping[]) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('BEGIN');
  try {
    const entities = db.prepare('SELECT kind,id,latest_revision,public_revision FROM entities ORDER BY kind,id').all();
    const revisions = db.prepare('SELECT kind,entity_id,revision,payload,state FROM revisions ORDER BY kind,entity_id,revision').all();
    const media = db.prepare('SELECT id,object_key,proof_key,proof_hashes,version,state,license,original_hash,thumbnail_hash FROM admin_media ORDER BY id').all();
    const revoked = db.prepare('SELECT id FROM revoked_media ORDER BY id').all();
    const counts = { craft: 0, template: 0, exhibit: 0, story: 0 };
    for (const entity of entities) {
      assert(Object.hasOwn(counts, String(entity.kind)), 'Unexpected content kind');
      counts[String(entity.kind) as keyof typeof counts]++;
    }
    assert.deepEqual(counts, { craft: 1, template: 3, exhibit: 12, story: 3 });
    assert.equal(media.length, 15, 'Unexpected media count');
    assert.equal(revoked.length, 0, 'Initialized media has been revoked');
    const mediaMappings = mappings.filter(item => item.mediaId !== undefined);
    const contentMappings = mappings.filter(item => item.contentId !== undefined);
    assert.equal(mediaMappings.length, 15, 'Missing media mappings');
    assert.equal(contentMappings.length, 15, 'Missing content mappings');
    assert.equal(new Set(mediaMappings.map(item => item.candidate)).size, 15, 'Duplicate media candidate');
    assert.equal(new Set(mediaMappings.map(item => item.mediaId)).size, 15, 'Duplicate generated media ID');
    assert.equal(new Set(contentMappings.map(item => item.contentId)).size, 15, 'Duplicate generated content ID');
    for (const mapping of contentMappings) {
      const entity = entities.find(item => item.kind === mapping.kind && item.id === mapping.contentId);
      assert(entity && entity.public_revision === mapping.revision, `Missing published mapping ${mapping.candidate}`);
      const revision = revisions.find(item => item.kind === mapping.kind && item.entity_id === mapping.contentId && item.revision === mapping.revision);
      assert(revision && revision.state === 'published', `Missing published revision ${mapping.candidate}`);
      const payload = JSON.parse(String(revision.payload)) as { media?: Array<{ id: string }>; cover?: { id: string } };
      const mappedMedia = mediaMappings.find(item => item.candidate === mapping.candidate);
      assert(mappedMedia, `Missing media link ${mapping.candidate}`);
      const associatedIds = mapping.kind === 'exhibit' ? payload.media?.map(item => item.id) : [payload.cover?.id];
      assert.deepEqual(associatedIds, [mappedMedia.mediaId], `Incorrect generated media mapping ${mapping.candidate}`);
    }
    const files: Array<{ key: string; name: string; hash: string }> = [];
    for (const item of media) {
      const mapping = mediaMappings.find(entry => entry.mediaId === item.id);
      assert(mapping && item.version === mapping.mediaRevision && item.state === 'approved', `Media revision changed ${String(item.id)}`);
      assert(typeof item.proof_key === 'string' && typeof item.proof_hashes === 'string', 'Missing private technical record');
      const proofHashes = JSON.parse(item.proof_hashes) as { original: string; thumbnail: string };
      for (const [key, original, thumbnail] of [[String(item.object_key), item.original_hash, item.thumbnail_hash], [item.proof_key, proofHashes.original, proofHashes.thumbnail]]) {
        assert(/^[0-9a-f-]{36}$/u.test(String(key)), 'Invalid media storage key');
        assert(!lstatSync(join(mediaRoot, String(key))).isSymbolicLink(), 'Media object must not be a symbolic link');
        for (const [name, expected] of [['original.png', original], ['thumbnail.png', thumbnail]]) {
          const path = join(mediaRoot, String(key), String(name));
          assert(!lstatSync(path).isSymbolicLink(), 'Media file must not be a symbolic link');
          const actual = hash(readFileSync(path));
          assert.equal(actual, expected, `Stored media hash mismatch: ${String(item.id)} ${String(name)}`);
          files.push({ key: String(key), name: String(name), hash: actual });
        }
      }
    }
    return {
      fingerprint: hash(JSON.stringify({ entities, revisions, media, revoked, files })),
      enabledAccounts: Number(db.prepare('SELECT COUNT(*) AS n FROM admin_accounts WHERE disabled=0').get()!.n),
      activeSessions: Number(db.prepare('SELECT COUNT(*) AS n FROM admin_sessions WHERE revoked=0 AND expires_at>?').get(Date.now())!.n),
    };
  } finally { db.exec('ROLLBACK'); db.close(); }
}
