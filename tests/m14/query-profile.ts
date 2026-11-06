// Phase measurements of the existing pipeline, using real projectors and isolated SQLite/HTTP.
import { ContentDatabase } from '../../apps/api/src/database';
import { developmentData } from '../../apps/api/src/database/development';
import { PublicContentService, contentRoutes } from '../../apps/api/src/content';
import { publicCraft, publicExhibit, publicStory, publicTemplate } from '../../apps/api/src/content/dto';
import { exhibits } from '@shoushang/fixtures';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const requireApi = createRequire(resolve('apps/api/package.json'));
const Fastify = requireApi('fastify') as typeof import('../../apps/api/node_modules/fastify').default;
async function main() {
  const evidence = resolve(process.argv[2]!); mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(tmpdir(), 'm14-query-profile-')), db = new ContentDatabase({ path: join(root, 'content.sqlite') });
  db.initializeDevelopment(developmentData);
  for (let i = 0; i < 1000; i++) {
    const row = { ...exhibits[0]!, id: `m14-load-${i}`, title: `自动化fixture ${i}`, storyIds: [], templateIds: ['template-dev-paper'], sortOrder: i };
    const revision = db.createRevision('exhibit', row, null, 'm14-isolated-load'); db.submit('exhibit', row.id, revision, 'm14-isolated-load'); db.publish('exhibit', row.id, revision, null, 'm14-isolated-load');
  }
  const samples = [];
  for (let round = 0; round < 12; round++) {
    const start = performance.now(), raw = db.readPublicSnapshot(), read = performance.now();
    const parsed = raw.rows.map(row => ({ kind: row.kind, payload: JSON.parse(String(row.payload)) as unknown })), parse = performance.now();
    const crafts: ReturnType<typeof publicCraft>[] = [], templates: ReturnType<typeof publicTemplate>[] = [], projectedExhibits: ReturnType<typeof publicExhibit>[] = [], stories: ReturnType<typeof publicStory>[] = [];
    for (const row of parsed) {
      switch (row.kind) { case 'craft': crafts.push(publicCraft(row.payload)); break; case 'template': templates.push(publicTemplate(row.payload)); break; case 'exhibit': projectedExhibits.push(publicExhibit(row.payload)); break; case 'story': stories.push(publicStory(row.payload)); break; }
    }
    const project = performance.now();
    const revoked = new Set(raw.revokedMedia), craftIds = new Set(crafts.map(c => c.id)), active = new Set(crafts.filter(c => c.status === 'active' && c.supportsExperience).map(c => c.id));
    const availableTemplates = templates.filter(t => t.enabled && active.has(t.craftId));
    const availableExhibits = projectedExhibits.filter(e => craftIds.has(e.craftId) && e.media.every(m => !revoked.has(m.id)));
    const availableStories = stories.filter(s => s.craftIds.every(id => craftIds.has(id)) && !revoked.has(s.cover.id));
    const templateIds = new Set(availableTemplates.map(t => t.id)), storyIds = new Set(availableStories.map(s => s.id)), exhibitIds = new Set(availableExhibits.map(e => e.id));
    const related = availableExhibits.map(e => ({ ...e, storyIds: e.storyIds.filter(id => storyIds.has(id)), templateIds: e.templateIds.filter(id => templateIds.has(id)) }));
    const relatedStories = availableStories.map(s => { const { templateId, ...rest } = s; return { ...rest, exhibitIds: s.exhibitIds.filter(id => exhibitIds.has(id)), ...(templateId && templateIds.has(templateId) ? { templateId } : {}) }; });
    const filter = performance.now();
    const validated = related.map(publicExhibit); relatedStories.map(publicStory); const second = performance.now();
    validated.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id, 'en-US'));
    const selected = validated.filter(r => r.craftId === 'craft-papercut').slice(0, 12), page = performance.now();
    const serialized = JSON.stringify({ ok: true, value: { items: selected, total: validated.length, page: 1, pageSize: 12 } }), serialize = performance.now();
    const service = new PublicContentService(db), serviceStart = performance.now(); service.listExhibits(); const serviceFirstMs = performance.now() - serviceStart;
    const repeatStart = performance.now(); service.listExhibits(); const serviceRepeatMs = performance.now() - repeatStart;
    samples.push({ round, sqliteReadMs: read - start, jsonParseMs: parse - read, publicProjectionValidationMs: project - parse, associationFilterMs: filter - project, secondProjectionValidationMs: second - filter, sortingFilteringPaginationMs: page - second, responseJsonSerializationMs: serialize - page, phaseTotalMs: serialize - start, serviceFirstMs, serviceRepeatMs, bytes: Buffer.byteLength(serialized) });
  }
  const app = Fastify(); await app.register(contentRoutes, { database: db });
  const serialization = new Map<string, number>(), httpSamples: { completeResponseMs: number; serializationMs: number; total: number }[] = [];
  app.addHook('preSerialization', (request, _reply, payload, done) => { serialization.set(request.id, performance.now()); done(null, payload); });
  let lastSerialization = 0;
  app.addHook('onSend', (request, _reply, payload, done) => { lastSerialization = performance.now() - (serialization.get(request.id) ?? performance.now()); serialization.delete(request.id); done(null, payload); });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try { for (let i = 0; i < 12; i++) { const start = performance.now(); const response = await fetch(`${address}/api/v1/exhibits?page=1&pageSize=12`); const body = await response.json() as { value: { total: number } }; httpSamples.push({ completeResponseMs: performance.now() - start, serializationMs: lastSerialization, total: body.value.total }); } }
  finally { await app.close(); db.close(); }
  writeFileSync(join(evidence, 'profile.json'), JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, rows: 1000, samples, httpSamples, method: '12 serial phase samples with actual SQLite read/public DTO projectors; phase transcription compared with unmodified service first/repeat, plus real loopback Fastify HTTP through complete JSON body. No production hooks added.' }, null, 2));
}
void main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
