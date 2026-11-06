/** Isolated cross-process M12 template revision exercise; never app startup. */
import { ContentDatabase } from '../../apps/api/src/database';
import { candidateById } from './template-candidates';
const [path, id, action] = process.argv.slice(2);
if (!path?.includes('m14-3b-') || !path.endsWith('content.sqlite') || !id || !candidateById[id] || !['upgrade', 'disable'].includes(action ?? '')) throw new Error('Explicit isolated M14-3B template revision required');
const db = new ContentDatabase({ path });
try {
  const prior = candidateById[id];
  const version = action === 'upgrade' ? 2 : 3;
  const row = { ...prior, version, enabled: action !== 'disable', name: `${prior.name} · 隔离v${version}` };
  const revision = db.createRevision('template', row, version - 1, 'm14-3b-isolated');
  db.submit('template', id, revision, 'm14-3b-isolated');
  db.publish('template', id, revision, version - 1, 'm14-3b-isolated');
} finally { db.close(); }
