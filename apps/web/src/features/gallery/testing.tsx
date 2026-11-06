// Deterministic browser-only test entry. Never imported by the production composition root.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMockContentClient } from '@shoushang/content-client';
import { exhibits, crafts, templates } from '@shoushang/fixtures';
import type { ApiError, ContentClient, Exhibit, Result } from '@shoushang/contracts';
import { ContentQuerySchema } from '@shoushang/contracts';
import { openIndexedDbRepository } from '@shoushang/local-repository';
import { GalleryPage, GalleryFavorites } from './index';
import { WorkshopPage } from '../workshop';
import '@shoushang/ui/styles.css';

export interface Controls { missing: string[]; network: string[]; timeout: string[]; delay: Record<string, number>; listFailure: boolean; writeFailure: boolean; readFailure: boolean; brokenImage: boolean; badTemplate: boolean; calls: string[]; active: number; maxActive: number }
declare global { interface Window { m10: Controls; m10Route(target: string): void } }
const controls: Controls = { missing: [], network: [], timeout: [], delay: {}, listFailure: false, writeFailure: false, readFailure: false, brokenImage: false, badTemplate: false, calls: [], active: 0, maxActive: 0 };
window.m10 = controls;
function fail<T>(code: ApiError['code']): Result<T> { return { ok: false, error: { code, message: 'M10 确定性测试故障', requestId: 'm10-test', fieldErrors: [] } }; }
const data: Exhibit[] = Array.from({ length: 31 }, (_, i) => ({ ...structuredClone(exhibits[0]!), id: `test-${String(i).padStart(2, '0')}`, title: `测试展品 ${String(i).padStart(2, '0')} ABC`, category: i < 15 ? '测试分类甲' : '测试分类乙', tags: i % 2 ? ['测试奇数'] : ['测试偶数'], craftId: i < 26 ? 'craft-papercut' : 'craft-test-other', sortOrder: Math.floor(i / 2), description: i === 30 ? '测试长正文：仅验证长文本换行与布局，不作为文化事实。LongUnbrokenTestTextForLayout'.repeat(80) : exhibits[0]!.description, summary: `测试简介 ${i}：仅为确定性测试内容，不作文化事实。`, sources: [{ ...exhibits[0]!.sources[0]!, url: 'https://example.org/source' }], media: [{ ...exhibits[0]!.media[0]!, license: { ...exhibits[0]!.media[0]!.license, url: 'https://example.org/license' } }] }));
const client: ContentClient = {
  ...createMockContentClient(),
  async listCrafts() { return { ok: true, value: [...crafts, { ...crafts[0]!, id: 'craft-test-other', name: '测试其他工艺', slug: 'test-other', supportsExperience: false }] }; },
  async listExhibits(input = {}) {
    const parsed = ContentQuerySchema.safeParse(input); if (!parsed.success) return fail('INVALID_INPUT');
    const q = parsed.data;
    const response: Result<import('@shoushang/contracts').Page<Exhibit>> = controls.listFailure ? fail('NETWORK_ERROR') : { ok: true, value: { items: [], total: 0, page: q.page, pageSize: q.pageSize } };
    if (response.ok) { const filtered = data.filter(e => !controls.missing.includes(e.id) && (!q.q || [e.title, e.summary, ...e.tags].join(' ').toLowerCase().includes(q.q)) && (!q.craftId || e.craftId === q.craftId) && (!q.category || e.category === q.category) && (!q.tag || e.tags.includes(q.tag))); response.value.total = filtered.length; response.value.items = structuredClone(filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)); if (controls.brokenImage) response.value.items.forEach(e => { e.media[0]!.url = '/m10-missing.png'; }); }
    const delay = controls.delay[`q:${q.q ?? ''}`] ?? 0;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    return response;
  },
  async getExhibit(id) {
    controls.calls.push(id); controls.active++; controls.maxActive = Math.max(controls.active, controls.maxActive);
    const found = data.find(e => e.id === id);
    const response: Result<Exhibit> = controls.timeout.includes(id) ? fail('TIMEOUT') : controls.network.includes(id) ? fail('NETWORK_ERROR') : controls.missing.includes(id) || !found ? fail('NOT_FOUND') : { ok: true, value: structuredClone(found) };
    if (response.ok && id === 'test-02') response.value.templateIds = ['template-test-second'];
    if (response.ok && controls.brokenImage) response.value.media[0]!.url = '/m10-missing.png';
    await new Promise(resolve => setTimeout(resolve, controls.delay[id] ?? 10));
    controls.active--; return response;
  },
  async listTemplates() { return { ok: true, value: { items: [structuredClone(templates[0]!), secondTemplate], total: 2, page: 1, pageSize: 12 } }; },
  async getTemplate(id) { return controls.badTemplate ? fail('NOT_FOUND') : id === secondTemplate.id ? { ok: true, value: structuredClone(secondTemplate) } : id === templates[0]!.id ? { ok: true, value: structuredClone(templates[0]!) } : fail('NOT_FOUND'); },
};
const secondTemplate = { ...structuredClone(templates[0]!), id: 'template-test-second', name: '测试第二模板', recommendedColors: ['#276B62'] };
function Harness() {
  const [url, setUrl] = useState(new URLSearchParams(location.search).get('route') ?? '/gallery');
  const name = new URLSearchParams(location.search).get('db');
  if (!name?.startsWith('m10-test-')) throw new Error('Explicit isolated database required');
  const store = useMemo(() => new GalleryFavorites(async () => {
    const opened = await openIndexedDbRepository({ name });
    if (!opened.ok) return opened;
    const connection = opened.value;
    return { ok: true, value: { close: () => connection.close(), favorites: {
      list: () => controls.readFailure ? Promise.resolve({ ok: false as const, error: { code: 'STORAGE_UNAVAILABLE' as const, message: '测试读取失败', requestId: 'test', fieldErrors: [] } }) : connection.favorites.list(),
      put: f => controls.writeFailure ? Promise.resolve({ ok: false as const, error: { code: 'QUOTA_EXCEEDED' as const, message: '测试写入失败', requestId: 'test', fieldErrors: [] } }) : connection.favorites.put(f),
      remove: id => controls.writeFailure ? Promise.resolve({ ok: false as const, error: { code: 'STORAGE_UNAVAILABLE' as const, message: '测试移除失败', requestId: 'test', fieldErrors: [] } }) : connection.favorites.remove(id),
    } } };
  }), [name]);
  function navigate(target: string) {
    if (target.startsWith('/workshop/') && !target.includes('template-test-second')) { location.href = `${target}&m07db=${encodeURIComponent(name!)}`; return; }
    history.pushState({}, '', `${location.pathname}?${new URLSearchParams({ db: name!, route: target })}`); setUrl(target);
  }
  window.m10Route = navigate;
  useEffect(() => { const pop = () => setUrl(new URLSearchParams(location.search).get('route') ?? '/gallery'); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  if (url.startsWith('/workshop/')) return <WorkshopPage contentClient={client} databaseName={name} initialTemplateId={new URL(url, location.origin).searchParams.get('templateId') ?? ''} onExit={() => navigate('/gallery')} />;
  return <GalleryPage client={client} url={url} navigate={navigate} favorites={store} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
