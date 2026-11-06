// Explicit isolated test worker; no credentials or private content in output.
import { ContentDatabase } from '../database';
import type { ContentKind } from '../database';
import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8')) as { path: string; operation: 'publish' | 'unpublish' | 'revoke'; kind: ContentKind; id: string; payload: unknown; latest: number | null; previous: number | null };
if (!input.path.includes('m14-query-cache-')) throw new Error('New isolated query-cache database required');
const db = new ContentDatabase({ path: input.path });
try {
  if (input.operation === 'revoke') db.revokeMedia(input.id, 'isolated-worker');
  else if (input.operation === 'unpublish') db.unpublish(input.kind, input.id, input.previous!, 'isolated-worker');
  else { const revision = db.createRevision(input.kind, input.payload, input.latest, 'isolated-worker'); db.submit(input.kind, input.id, revision, 'isolated-worker'); db.publish(input.kind, input.id, revision, input.previous, 'isolated-worker'); }
  process.stdout.write('ok');
} finally { db.close(); }
