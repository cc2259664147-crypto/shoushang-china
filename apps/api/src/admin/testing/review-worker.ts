import { ContentDatabase, AdminError } from '../../database';
import type { Access } from '../../database';
let input = '';
for await (const chunk of process.stdin) { input += String(chunk); if (input.length > 10000) throw new Error('bounded test input'); }
const p = JSON.parse(input) as { path: string; access: Access; id: string; request: unknown; key: string; operation: 'publish' | 'review' };
const db = new ContentDatabase({ path: p.path });
try {
    try {
        if (p.operation === 'publish') db.admin.publish(p.access, 'exhibit', p.id, p.request, p.key);
        else db.admin.review(p.access, 'exhibit', p.id, p.request);
        process.stdout.write(JSON.stringify({ ok: true }));
    } catch (e) { if (!(e instanceof AdminError)) throw e; process.stdout.write(JSON.stringify({ ok: false, code: e.code })); }
} finally { db.close(); }
