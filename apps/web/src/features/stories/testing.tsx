// Test entry only. Synthetic people/experiences never enter production content statistics.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMockContentClient } from '@shoushang/content-client';
import { StorySchema, ContentQuerySchema } from '@shoushang/contracts';
import type { ApiError, ContentClient, Result, Story } from '@shoushang/contracts';
import { stories, exhibits, templates, crafts } from '@shoushang/fixtures';
import { HomePage } from '../home';
import { StoriesPage } from './StoriesPage';
import { GalleryPage, GalleryFavorites } from '../gallery';
import { WorkshopPage } from '../workshop';
import { openIndexedDbRepository } from '@shoushang/local-repository';
import { SiteNav } from '../../app/SiteNav';
import '../../styles/global.css';
import '@shoushang/ui/styles.css';

export interface M11Controls { home: 'normal' | 'full' | 'empty' | 'failure'; listFailure: boolean; craftsFailure: boolean; missing: string[]; forbidden: string[]; network: string[]; delay: Record<string, number>; imageFailure: boolean; template: 'normal' | 'missing' | 'disabled' | 'other' | 'unsupported' | 'wrong-id'; related: 'normal' | 'missing' | 'failure' | 'wrong-id'; calls: string[] }
declare global { interface Window { m11: M11Controls; m11Route(target: string): void } }
const control: M11Controls = { home: 'normal', listFailure: false, craftsFailure: false, missing: [], forbidden: [], network: [], delay: {}, imageFailure: false, template: 'normal', related: 'normal', calls: [] };
window.m11 = control;
function fail<T>(code: ApiError['code']): Result<T> { return { ok: false, error: { code, message: 'M11 确定性测试故障', requestId: 'm11-test', fieldErrors: [] } }; }
const source = { ...stories[0]!.sources[0]!, title: '测试来源：仅用于界面验证', url: 'https://example.org/test-source' };
const rows: Story[] = Array.from({ length: 31 }, (_, i) => StorySchema.parse({ ...structuredClone(stories[0]!), id: `story-test-${String(i).padStart(2, '0')}`, title: `测试故事 ${String(i).padStart(2, '0')}（非真实人物）`, personName: `测试人物 ${i}，非真实匠人`, personBio: '仅为确定性测试适配器，无真实身份或经历断言。', craftIds: [i < 26 ? 'craft-papercut' : 'craft-test-other'], region: '测试地区（虚构）', summary: `测试摘要 ${i}，不作为文化事实。`, sortOrder: Math.floor(i / 2), cover: { ...stories[0]!.cover, license: { ...stories[0]!.cover.license, url: 'https://example.org/test-license' } }, body: [{ type: 'paragraph', text: i === 30 ? '测试长正文LongUnbrokenTextForLayout'.repeat(300) : `测试正文 ${i}。<script>不执行任意 HTML</script>` }], timeline: Array.from({ length: i % 4 }, (_, n) => ({ dateLabel: ['早年（测试原文）', '未注明具体时间', '后来（测试原文）'][n]!, text: `测试经历 ${n}，不作为文化事实。`, sources: [source] })), sources: [source], templateId: 'template-m11-second' }));
const secondTemplate = { ...structuredClone(templates[0]!), id: 'template-m11-second', name: '测试精确关联模板', recommendedColors: ['#276B62'] };
const homeExhibits = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(exhibits[0]!), id: `exhibit-test-${i}`, title: `测试展品 ${i}（非正式文化内容）` }));
async function wait(key: string) { const ms = control.delay[key] ?? 0; if (ms) await new Promise(resolve => setTimeout(resolve, ms)); }
function picture(story: Story) { const value = structuredClone(story); if (control.imageFailure) value.cover.url = '/m11-image-unavailable.png'; return value; }
const client: ContentClient = {
  ...createMockContentClient(),
  async listCrafts() { return control.craftsFailure ? fail('NETWORK_ERROR') : { ok: true, value: [...crafts, { ...crafts[0]!, id: 'craft-test-other', slug: 'test-other', name: '测试其他工艺', supportsExperience: false }] }; },
  async getHome() { const result = control.home === 'failure' ? fail<Awaited<ReturnType<ContentClient['getHome']>> extends Result<infer T> ? T : never>('NETWORK_ERROR') : { ok: true as const, value: { exhibits: control.home === 'empty' ? [] : control.home === 'full' ? structuredClone([homeExhibits[0]!, ...homeExhibits]) : structuredClone(exhibits), stories: control.home === 'empty' ? [] : (control.home === 'full' ? [rows[0]!, ...rows.slice(0, 5)] : rows.slice(0, 2)).map(picture) } }; await wait('home'); return result; },
  async listStories(query = {}) {
    const parsed = ContentQuerySchema.safeParse(query); if (!parsed.success) return fail('INVALID_INPUT');
    const q = parsed.data, filtered = rows.filter(s => (!q.craftId || s.craftIds.includes(q.craftId)) && !control.missing.includes(s.id));
    const result = control.listFailure ? fail<import('@shoushang/contracts').Page<Story>>('NETWORK_ERROR') : { ok: true as const, value: { items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(picture), total: filtered.length, page: q.page, pageSize: q.pageSize } };
    await wait(`craft:${q.craftId ?? ''}`); return result;
  },
  async getStory(id) { control.calls.push(id); const found = rows.find(s => s.id === id) ?? stories.find(s => s.id === id); const result = control.missing.includes(id) || !found ? fail<Story>('NOT_FOUND') : control.forbidden.includes(id) ? fail<Story>('FORBIDDEN') : control.network.includes(id) ? fail<Story>('NETWORK_ERROR') : { ok: true as const, value: picture(found) }; await wait(id); return result; },
  async getExhibit(id) { control.calls.push(id); if (control.related === 'failure') return fail('NETWORK_ERROR'); const found = exhibits.find(e => e.id === id) ?? homeExhibits.find(e => e.id === id); return !found || control.related === 'missing' ? fail('NOT_FOUND') : { ok: true, value: { ...structuredClone(found), ...(control.related === 'wrong-id' ? { id: 'wrong-id' } : {}) } }; },
  async getTemplate(id) { control.calls.push(id); if (control.template === 'missing') return fail('NOT_FOUND'); if (id !== secondTemplate.id && id !== templates[0]!.id) return fail('NOT_FOUND'); const t = structuredClone(id === secondTemplate.id ? secondTemplate : templates[0]!); if (control.template === 'disabled') t.enabled = false; if (control.template === 'other') t.craftId = 'craft-test-other'; if (control.template === 'wrong-id') t.id = 'wrong-id'; if (control.template === 'unsupported') t.geometry.basePaper = { kind: 'circle' }; return { ok: true, value: t }; },
  async listTemplates() { return { ok: true, value: { items: [secondTemplate], total: 1, page: 1, pageSize: 12 } }; },
};
function Harness() {
  const [route, setRoute] = useState(new URLSearchParams(location.search).get('route') ?? '/');
  const name = new URLSearchParams(location.search).get('db');
  if (!name?.startsWith('m07-test-m11-')) throw new Error('M11 isolated database required');
  const favorites = useMemo(() => new GalleryFavorites(() => openIndexedDbRepository({ name })), [name]);
  function navigate(target: string) { history.pushState({}, '', `${location.pathname}?${new URLSearchParams({ db: name!, route: target })}`); setRoute(target); }
  window.m11Route = navigate;
  useEffect(() => { const pop = () => setRoute(new URLSearchParams(location.search).get('route') ?? '/'); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  if (route.startsWith('/workshop/')) return <WorkshopPage contentClient={client} databaseName={name} initialTemplateId={new URL(route, location.origin).searchParams.get('templateId') ?? ''} onExit={() => navigate('/')} />;
  return <><p style={{ padding: 8, margin: 0 }}>M11 确定性测试适配器 · 所有人物与经历仅为测试</p><SiteNav navigate={navigate} url={route} />{route.startsWith('/stories') ? <StoriesPage client={client} url={route} navigate={navigate} /> : route.startsWith('/gallery') ? <GalleryPage client={client} url={route} navigate={navigate} favorites={favorites} /> : <HomePage client={client} navigate={navigate} />}</>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
