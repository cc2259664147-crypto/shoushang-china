import { ContentDatabase } from '../../database';
import type { Access } from '../../database';
let input = '';
for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 10000)
        throw new Error('bounded test input');
}
const p = JSON.parse(input) as {
    path: string;
    access: Access;
    id: string;
    request: unknown;
    key: string;
};
const db = new ContentDatabase({ path: p.path });
try {
    const result = db.admin.publish(p.access, 'exhibit', p.id, p.request, p.key);
    process.stdout.write(JSON.stringify({ revision: result.revision, publicRevision: result.publicRevision }) + '\n');
}
finally {
    db.close();
}
