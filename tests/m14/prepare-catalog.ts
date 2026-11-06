// Explicit synthetic test catalog; never a source of formal cultural content.
import { ContentDatabase } from '../../apps/api/src/database';
import { exhibits } from '@shoushang/fixtures';
const path = process.argv[2];
if (!path || !path.includes('m14-normal-')) throw new Error('Explicit new M14 isolated catalog database required');
const db = new ContentDatabase({ path });
try {
  for (let i = 0; i < 25; i++) {
    const row = { ...exhibits[0]!, id: `m14-catalog-${i}`, title: `自动化fixture ${String(i).padStart(2, '0')} ${i % 2 ? 'XYZ' : 'ABC'}`,
      category: i % 3 ? '测试乙' : '测试甲', tags: [i % 2 ? '测试奇数' : '测试偶数'], storyIds: [], templateIds: ['template-dev-paper'], sortOrder: i };
    const revision = db.createRevision('exhibit', row, null, 'm14-isolated-catalog');
    db.submit('exhibit', row.id, revision, 'm14-isolated-catalog'); db.publish('exhibit', row.id, revision, null, 'm14-isolated-catalog');
  }
} finally { db.close(); }
