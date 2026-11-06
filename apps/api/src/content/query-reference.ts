// Test-only transcription of the pre-M14-2A public pipeline. Never imported by routes.
import { ContentQuerySchema } from '@shoushang/contracts';
import type { ContentQuery } from '@shoushang/contracts';
import type { ContentDatabase } from '../database';
import { publicCraft, publicExhibit, publicStory, publicTemplate } from './dto';
export function referenceSnapshot(database: ContentDatabase) {
  const raw = database.readPublicSnapshot();
  const crafts: ReturnType<typeof publicCraft>[] = [], templates: ReturnType<typeof publicTemplate>[] = [], exhibits: ReturnType<typeof publicExhibit>[] = [], stories: ReturnType<typeof publicStory>[] = [];
  for (const row of raw.rows) {
    if (typeof row.payload !== 'string') throw new Error('Invalid stored content');
    const payload: unknown = JSON.parse(row.payload);
    switch (row.kind) { case 'craft': crafts.push(publicCraft(payload)); break; case 'template': templates.push(publicTemplate(payload)); break; case 'exhibit': exhibits.push(publicExhibit(payload)); break; case 'story': stories.push(publicStory(payload)); break; }
  }
  const revoked = new Set(raw.revokedMedia), craftIds = new Set(crafts.map(c => c.id)), active = new Set(crafts.filter(c => c.status === 'active' && c.supportsExperience).map(c => c.id));
  const availableTemplates = templates.filter(t => t.enabled && active.has(t.craftId)).sort((a, b) => a.id.localeCompare(b.id, 'en-US'));
  const availableExhibits = exhibits.filter(e => craftIds.has(e.craftId) && e.media.every(m => !revoked.has(m.id)));
  const availableStories = stories.filter(s => s.craftIds.every(id => craftIds.has(id)) && !revoked.has(s.cover.id));
  const templateIds = new Set(availableTemplates.map(t => t.id)), exhibitIds = new Set(availableExhibits.map(e => e.id)), storyIds = new Set(availableStories.map(s => s.id));
  const compare = (a: { sortOrder: number; id: string }, b: { sortOrder: number; id: string }) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id, 'en-US');
  return {
    crafts: crafts.sort((a, b) => a.id.localeCompare(b.id, 'en-US')), templates: availableTemplates,
    exhibits: availableExhibits.map(e => publicExhibit({ ...e, storyIds: e.storyIds.filter(id => storyIds.has(id)), templateIds: e.templateIds.filter(id => templateIds.has(id)) })).sort(compare),
    stories: availableStories.map(s => { const { templateId, ...rest } = s; return publicStory({ ...rest, exhibitIds: s.exhibitIds.filter(id => exhibitIds.has(id)), ...(templateId && templateIds.has(templateId) ? { templateId } : {}) }); }).sort(compare),
  };
}
export function referenceExhibits(database: ContentDatabase, query: ContentQuery = {}) {
  const q = ContentQuerySchema.parse(query);
  const items = referenceSnapshot(database).exhibits.filter(r => (!q.craftId || r.craftId === q.craftId) && (!q.category || r.category === q.category) && (!q.tag || r.tags.includes(q.tag)) && (!q.q || [r.title, r.summary, ...r.tags].join(' ').toLowerCase().includes(q.q)));
  const offset = BigInt(q.page - 1) * BigInt(q.pageSize);
  return { items: offset >= BigInt(items.length) ? [] : items.slice(Number(offset), Number(offset) + q.pageSize), total: items.length, page: q.page, pageSize: q.pageSize };
}
