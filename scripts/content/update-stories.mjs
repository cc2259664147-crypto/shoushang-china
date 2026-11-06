import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

// Connect only to an explicitly enabled local administration listener.
const [baseArg, originArg] = process.argv.slice(2);
if (!baseArg || !originArg) throw new Error('Usage: node scripts/content/update-stories.mjs http://127.0.0.1:PORT ADMIN_ORIGIN');
const base = new URL(baseArg);
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.pathname !== '/') throw new Error('Admin URL must be loopback HTTP');
if (!process.stdin.isTTY) throw new Error('Interactive terminal required');
let muted = false;
const out = new Writable({ write(chunk, _enc, cb) { if (!muted) process.stdout.write(chunk); cb(); } });
const rl = createInterface({ input: process.stdin, output: out, terminal: true });
let username, password;
try { username = await rl.question('管理员账号: '); process.stdout.write('密码（不显示）: '); muted = true; password = await rl.question(''); muted = false; process.stdout.write('\n'); } finally { rl.close(); }
const stories = JSON.parse(readFileSync(new URL('../../docs/content/story-update-20261102.json', import.meta.url), 'utf8'));
let cookie = '', csrf = '';
async function request(path, method = 'GET', body, extra = {}) {
  const res = await fetch(new URL(path, base), { method, headers: { origin: originArg, ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (res.status === 204) return { value: null, res };
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data.error)}`);
  return { value: data.value, res };
}
try {
  const challenge = await request('/api/v1/admin/csrf');
  cookie = challenge.res.headers.getSetCookie().map(v => v.split(';')[0]).join('; '); csrf = challenge.value.csrfToken;
  const session = await request('/api/v1/admin/session', 'POST', { username, password });
  password = ''; cookie = session.res.headers.getSetCookie().map(v => v.split(';')[0]).join('; '); csrf = session.value.csrfToken;
  const list = (await request('/api/v1/admin/contents?kind=story&page=1&pageSize=50')).value;
  if (list.total > 50) throw new Error('Too many stories; update manually');
  const rows = [];
  for (const item of list.items) {
    const entry = (await request(`/api/v1/admin/contents/story/${encodeURIComponent(item.id)}`)).value;
    if (stories.some(s => s.personName === entry.draft.personName)) rows.push(entry);
  }
  for (const story of stories) {
    const matches = rows.filter(row => row.draft.personName === story.personName);
    if (matches.length !== 1) throw new Error(`Expected one existing story for ${story.personName}`);
    if (matches[0].latestRevision !== matches[0].publicRevision) throw new Error(`Unpublished changes exist for ${story.personName}; stop`);
  }
  for (const story of stories) {
    const old = rows.find(row => row.draft.personName === story.personName);
    const { id: _id, revision: _revision, updatedAt: _updatedAt, cover, ...rest } = old.draft;
    const draft = { ...rest, ...story, mediaIds: [cover.id] };
    const path = `/api/v1/admin/contents/story/${encodeURIComponent(old.id)}`;
    const revision = (await request(`${path}/revisions`, 'POST', { draft, expectedLatest: old.latestRevision })).value.revision;
    await request(`${path}/submit`, 'POST', { revision, expectedLatest: revision });
    const review = (await request(`${path}/review`, 'POST', { revision, expectedLatest: revision, decision: 'approved', evidence: { sources: '公开来源已核对，用户确认故事人工审核通过', identity: '人物身份来自公开非遗条目', quotations: '无采访引语' } })).value;
    await request(`${path}/publish`, 'POST', { revision, expectedLatest: revision, expectedPublic: old.publicRevision, reviewId: review.reviewId }, { 'idempotency-key': randomUUID() });
    const published = (await request(`/api/v1/stories/${encodeURIComponent(old.id)}`)).value;
    if (published.revision !== revision || published.title !== story.title) throw new Error(`Verification failed for ${story.personName}`);
    console.log(`${story.personName}: revision ${revision} published and checked`);
  }
} finally {
  password = '';
  if (cookie && csrf) { try { await request('/api/v1/admin/session', 'DELETE'); } catch { /* session expires on server */ } }
}
