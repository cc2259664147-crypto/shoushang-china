import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { ContentQuerySchema, IdSchema, TemplateVersionV1Schema } from '@shoushang/contracts';
import type { ContentClient, Craft, Exhibit, Media, Page, PublicTemplate, Result, Story } from '@shoushang/contracts';
import { Button, Dialog, EmptyState, FormField, InlineNotice, LoadingState, Select, TextInput } from '@shoushang/ui';
import { openIndexedDbRepository } from '@shoushang/local-repository';
import { createPapercutCore } from '@shoushang/papercut-core';
import { GalleryFavorites } from './favorites';
import { galleryUrl, loadVocabulary, mapLimited, parseQuery, safeReturn, verificationSlot } from './query';
import type { Vocabulary } from './query';
import { hasCreatableEditorProfile } from '../workshop/editor/profiles';
import './gallery.css';

export interface GalleryPageProps { client: ContentClient; url: string; navigate(target: string): void; favorites?: GalleryFavorites }
type LinkProps = { href: string; children: ReactNode; onLeave?: () => void; id?: string };
function plainClick(e: MouseEvent<HTMLAnchorElement>) { return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !e.defaultPrevented; }
function Link({ href, children, navigate, onLeave, id }: LinkProps & { navigate(target: string): void }) {
  return <a {...(id ? { id } : {})} href={href} onClick={e => { if (plainClick(e)) { e.preventDefault(); onLeave?.(); navigate(href); } }}>{children}</a>;
}
function Picture({ media, large = false, thumbnail = false }: { media: Media; large?: boolean; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  const originalPath = `/api/v1/media/${media.id}/original`;
  const canUseThumbnail = thumbnail && media.url === originalPath;
  const src = canUseThumbnail && !useOriginal ? `/api/v1/media/${media.id}/thumbnail` : media.url;
  return failed ? <div className="ga-image-failed" role="img" aria-label={`图片加载失败：${media.alt}`}>图片加载失败：{media.alt}</div> : <img loading={large ? 'eager' : 'lazy'} src={src} alt={media.alt} width={media.width} height={media.height} onError={() => { if (canUseThumbnail && !useOriginal) setUseOriginal(true); else setFailed(true); }} />;
}
function FavoriteButton({ id, store }: { id: string; store: GalleryFavorites }) {
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const selected = !!state.items?.some(f => f.exhibitId === id);
  return <Button intent="secondary" aria-pressed={state.items === null ? undefined : selected} disabled={state.items === null} loading={state.pending.has(id)} onClick={() => { void store.toggle(id); }}>{state.items === null ? '收藏状态未知' : selected ? '取消收藏' : '收藏'}</Button>;
}
function Failure({ message, retry }: { message: string; retry(): void }) { return <InlineNotice tone="error">{message}<Button intent="secondary" onClick={retry}>重试</Button></InlineNotice>; }
function Dev({ client, exhibit }: { client: ContentClient; exhibit?: Exhibit }) { return client.mode === 'mock' || exhibit?.developmentOnly ? <InlineNotice tone="warning">开发示例（{client.mode}）：仅用于工程验证，未经正式文化内容审核，不代表正式展馆发布。</InlineNotice> : null; }
function conditions(search: string) { const q = new URLSearchParams(search); return ['q', 'craftId', 'category', 'tag'].filter(k => q.has(k)).map(k => `${k}=${q.get(k)}`).join('，') || '全部展品'; }
interface Position { id: string; offset: number; y: number }
const positions = new Map<string, Position>();
function remember(url: string, id: string) {
  const element = document.getElementById(`exhibit-${id}`);
  const value = { id, offset: element?.getBoundingClientRect().top ?? 0, y: scrollY };
  positions.set(url, value);
  try { sessionStorage.setItem(`gallery-position:${url}`, JSON.stringify(value)); } catch { /* Position persistence is optional. */ }
}
function useRestore(url: string, ready: boolean) {
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || restored.current === url) return;
    restored.current = url;
    let value = positions.get(url);
    try { const stored: unknown = JSON.parse(sessionStorage.getItem(`gallery-position:${url}`) ?? 'null'); if (!value && stored && typeof stored === 'object' && 'id' in stored && typeof stored.id === 'string' && 'offset' in stored && typeof stored.offset === 'number' && 'y' in stored && typeof stored.y === 'number') value = stored as Position; } catch { /* Ignore corrupt optional positions. */ }
    if (!value) { scrollTo(0, 0); return; }
    const position = value;
    const restore = () => { const element = document.getElementById(`exhibit-${position.id}`); if (element) scrollBy(0, element.getBoundingClientRect().top - position.offset); else scrollTo(0, position.y); };
    const anchor = document.getElementById(`exhibit-${position.id}`);
    anchor?.focus({ preventScroll: true }); restore();
    const observer = new ResizeObserver(restore); observer.observe(document.documentElement);
    const stop = () => observer.disconnect();
    const timer = setTimeout(stop, 1500);
    window.addEventListener('wheel', stop, { once: true }); window.addEventListener('touchstart', stop, { once: true }); window.addEventListener('keydown', stop, { once: true });
    return () => { clearTimeout(timer); stop(); window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); window.removeEventListener('keydown', stop); };
  }, [url, ready]);
}
function Card({ exhibit, crafts, client, store, from, navigate }: { exhibit: Exhibit; crafts: Craft[]; client: ContentClient; store: GalleryFavorites; from: string; navigate(target: string): void }) {
  const detail = `/gallery/${encodeURIComponent(exhibit.id)}?${new URLSearchParams({ returnTo: from })}`;
  return <article className="ga-card"><Picture key={exhibit.media[0]!.url} media={exhibit.media[0]!} thumbnail /><h2><Link id={`exhibit-${exhibit.id}`} href={detail} navigate={navigate} onLeave={() => remember(from, exhibit.id)}>{exhibit.title}</Link></h2><p>{crafts.find(c => c.id === exhibit.craftId)?.name ?? exhibit.craftId} · {exhibit.category}</p><p>{exhibit.summary}</p><p>标签：{exhibit.tags.join('、') || '无'}</p>{exhibit.developmentOnly && <p>开发示例 · 非正式文化内容</p>}<FavoriteButton id={exhibit.id} store={store} /><span className="ga-sr">{client.mode}</span></article>;
}
function GalleryList({ client, store, url, navigate }: GalleryPageProps & { store: GalleryFavorites }) {
  const search = new URL(url, location.origin).search, parsed = useMemo(() => parseQuery(search), [search]);
  const [draft, setDraft] = useState(() => new URLSearchParams(search).get('q') ?? '');
  const [formError, setFormError] = useState('');
  const [vocab, setVocab] = useState<Vocabulary | null>(null), [vocabError, setVocabError] = useState(''), [vocabRetry, setVocabRetry] = useState(0);
  const [result, setResult] = useState<Result<Page<Exhibit>> | null>(null), [retry, setRetry] = useState(0);
  const [resultKey, setResultKey] = useState('');
  useEffect(() => { const focus = () => { setResult(null); setRetry(n => n + 1); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, []);
  useEffect(() => { setDraft(new URLSearchParams(search).get('q') ?? ''); setFormError(''); }, [search]);
  useEffect(() => { let active = true; setVocab(null); setVocabError(''); void loadVocabulary(client).then(v => { if (active) setVocab(v); }, () => { if (active) setVocabError('筛选选项读取失败，未提供不完整分类'); }); return () => { active = false; }; }, [client, vocabRetry]);
  useEffect(() => {
    let active = true; setResult(null); setResultKey(search);
    if (parsed.ok) void client.listExhibits(parsed.value).then(r => { if (active) setResult(r); }, () => { if (active) setResult({ ok: false, error: { code: 'NETWORK_ERROR', message: '展馆请求失败', requestId: 'gallery', fieldErrors: [] } }); });
    return () => { active = false; };
  }, [client, parsed, retry, search]);
  const current = resultKey === search ? result : null;
  useRestore(url, !!current?.ok);
  function change(key: 'craftId' | 'category' | 'tag', value: string) { if (!parsed.ok) return; const next = { ...parsed.value, page: 1 }; delete next[key]; if (value) next[key] = value; navigate(galleryUrl(next)); }
  return <><h1>数字展馆</h1><Dev client={client} /><form onSubmit={e => { e.preventDefault(); if (!parsed.ok) return; const q = ContentQuerySchema.safeParse({ ...parsed.value, q: draft, page: 1 }); if (!q.success) { setFormError('关键词去除首尾空格后最多 100 个字符'); return; } navigate(galleryUrl(q.data)); }}><FormField label="搜索展品" description="名称、简介或标签，最多 100 个字符" {...(formError ? { error: formError } : {})}>{field => <TextInput {...field} value={draft} onChange={e => setDraft(e.target.value)} />}</FormField><Button type="submit" disabled={!parsed.ok}>搜索</Button></form>
    {!parsed.ok ? <InlineNotice tone="error">查询参数错误：{parsed.error}；原 URL 已保留。<Link href="/gallery" navigate={navigate}>清空筛选并返回展馆</Link></InlineNotice> : <>
      {vocabError ? <Failure message={vocabError} retry={() => setVocabRetry(n => n + 1)} /> : !vocab ? <LoadingState label="读取全馆筛选选项" /> : <div className="ga-filters">{(['craftId', 'category', 'tag'] as const).map(key => { const values = key === 'craftId' ? vocab.crafts.map(c => ({ value: c.id, label: c.name })) : vocab[key === 'category' ? 'categories' : 'tags'].map(value => ({ value, label: value })); const selected = parsed.value[key]; return <FormField key={key} label={{ craftId: '工艺', category: '分类', tag: '标签' }[key]}>{field => <Select {...field} value={selected ?? ''} options={[{ value: '', label: '全部' }, ...values, ...(selected && !values.some(v => v.value === selected) ? [{ value: selected, label: `未匹配：${selected}` }] : [])]} onChange={e => change(key, e.target.value)} />}</FormField>; })}</div>}
      {vocab && parsed.value.craftId && !vocab.crafts.some(c => c.id === parsed.value.craftId) && <InlineNotice tone="warning">工艺 ID 未匹配公开目录：{parsed.value.craftId}</InlineNotice>}
      <p className="ga-conditions">当前条件：{conditions(search)}</p>
      {!current ? <LoadingState label="加载展品" /> : !current.ok ? <Failure message={`${current.error.code}：${current.error.message}`} retry={() => setRetry(n => n + 1)} /> : <>
        {parsed.value.page > Math.max(1, Math.ceil(current.value.total / 12)) ? <EmptyState title="页码超出范围" description={`共 ${current.value.total} 件，所请求的第 ${parsed.value.page} 页不存在。`} action={<Link href={galleryUrl({ ...parsed.value, page: Math.max(1, Math.ceil(current.value.total / 12)) })} navigate={navigate}>前往有效末页</Link>} /> : !current.value.items.length ? <EmptyState title="没有匹配展品" description={`当前条件：${conditions(search)}`} action={<><Link href="/gallery" navigate={navigate}>清空筛选</Link> · <Link href="/gallery" navigate={navigate}>返回展馆</Link></>} /> : <div className="ga-grid">{current.value.items.map(exhibit => <Card key={exhibit.id} exhibit={exhibit} crafts={vocab?.crafts ?? []} client={client} store={store} from={url} navigate={navigate} />)}</div>}
        <nav className="ga-pagination" aria-label="展馆分页">{parsed.value.page > 1 ? <Link href={galleryUrl({ ...parsed.value, page: parsed.value.page - 1 })} navigate={navigate}>上一页</Link> : <span>上一页（不可用）</span>}<span>第 {parsed.value.page} / {Math.max(1, Math.ceil(current.value.total / 12))} 页 · 共 {current.value.total} 件</span>{parsed.value.page * 12 < current.value.total ? <Link href={galleryUrl({ ...parsed.value, page: parsed.value.page + 1 })} navigate={navigate}>下一页</Link> : <span>下一页（不可用）</span>}</nav>
      </>}
    </>}</>;
}
export function templateSupported(template: PublicTemplate, craftId: string) {
  if (!template.enabled || template.craftId !== craftId || craftId !== 'craft-papercut' || !hasCreatableEditorProfile(template)) return false;
  const legacy = TemplateVersionV1Schema.safeParse(template);
  if (!legacy.success) {
    return template.geometry.basePaper.kind === 'square'
      && (template.geometry.symmetry.kind === 'reflection' && template.geometry.symmetry.axis === 'vertical'
        || template.geometry.symmetry.kind === 'radial' && template.geometry.symmetry.sectors === 4 && !template.geometry.symmetry.mirror);
  }
  return createPapercutCore().createState({ id: 'gallery-probe', name: '模板预检', craftId, templateSnapshot: legacy.data, operations: [], palette: { paper: legacy.data.recommendedColors[0]!, background: '#FFFFEE' }, status: 'draft', revision: 0, schemaVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }).ok;
}
function RelatedStories({ exhibit, client, navigate }: { exhibit: Exhibit; client: ContentClient; navigate(target: string): void }) {
  const [rows, setRows] = useState<{ id: string; result: Result<Story> }[] | null>(null);
  useEffect(() => {
    let active = true; setRows(null);
    void mapLimited(exhibit.storyIds, async id => {
      try { const result = await client.getStory(id); return { id, result: result.ok && result.value.id !== id ? { ok: false as const, error: { code: 'NETWORK_ERROR' as const, message: '关联故事 ID 不一致', requestId: 'gallery-story', fieldErrors: [] } } : result }; }
      catch { return { id, result: { ok: false as const, error: { code: 'NETWORK_ERROR' as const, message: '故事核验失败', requestId: 'gallery-story', fieldErrors: [] } } }; }
    }).then(value => { if (active) setRows(value); });
    return () => { active = false; };
  }, [exhibit, client]);
  return <div>{rows === null ? <LoadingState label="核验关联故事" /> : !rows.length ? <p>未配置关联故事。</p> : rows.map(({ id, result }) => <p key={id}>{result.ok ? <><Link href={`/stories/${encodeURIComponent(id)}`} navigate={navigate}>关联故事：{result.value.title}</Link>{(client.mode === 'mock' || result.value.developmentOnly) && <span> · 开发示例，非真实人物故事</span>}</> : <span>关联故事 {id}：{result.error.code === 'NOT_FOUND' || result.error.code === 'FORBIDDEN' ? '不存在或不可公开访问' : '核验失败，可重新核验展品后重试'}</span>}</p>)}</div>;
}
function Associations({ exhibit, client, navigate }: { exhibit: Exhibit; client: ContentClient; navigate(target: string): void }) {
  const [templates, setTemplates] = useState<PublicTemplate[] | null>(null);
  useEffect(() => { let active = true; setTemplates(null); void mapLimited(exhibit.templateIds, async id => { try { const r = await client.getTemplate(id); return r.ok && r.value.id === id && templateSupported(r.value, exhibit.craftId) ? r.value : null; } catch { return null; } }).then(rows => { if (active) setTemplates(rows.filter((t): t is PublicTemplate => t !== null)); }); return () => { active = false; }; }, [exhibit, client]);
  return <section><h2>关联体验与故事</h2>{templates === null ? <LoadingState label="核验关联模板" /> : templates.length ? templates.map(t => <p key={t.id}><Link href={`/workshop/papercut?${new URLSearchParams({ templateId: t.id })}`} navigate={navigate}>体验关联模板：{t.name}</Link></p>) : <p>没有经核验可体验的关联剪纸模板；关联项可能不可用或暂不支持。</p>}<RelatedStories exhibit={exhibit} client={client} navigate={navigate} /></section>;
}
function Detail({ id, client, store, url, navigate }: GalleryPageProps & { id: string; store: GalleryFavorites }) {
  const [result, setResult] = useState<Result<Exhibit> | null>(null), [retry, setRetry] = useState(0), [large, setLarge] = useState<Media | null>(null);
  const [crafts, setCrafts] = useState<Craft[]>([]);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { let active = true; void client.listCrafts().then(r => { if (active && r.ok) setCrafts(r.value); }, () => {}); return () => { active = false; }; }, [client]);
  useEffect(() => {
    let active = true;
    const load = () => { setResult(null); setLarge(null); const request = ++generation; if (!IdSchema.safeParse(id).success) { setResult({ ok: false, error: { code: 'NOT_FOUND', message: '展品 ID 无效或不可公开访问', requestId: 'gallery', fieldErrors: [] } }); return; } void client.getExhibit(id).then(r => { if (active && request === generation) setResult(r); }, () => { if (active && request === generation) setResult({ ok: false, error: { code: 'NETWORK_ERROR', message: '详情加载失败', requestId: 'gallery', fieldErrors: [] } }); }); };
    let generation = 0; load(); window.addEventListener('focus', load);
    return () => { active = false; generation++; window.removeEventListener('focus', load); };
  }, [client, id, retry]);
  const back = safeReturn(new URL(url, location.origin).searchParams.get('returnTo'));
  return <><p><Link href={back} navigate={navigate}>返回{back.startsWith('/my/favorites') ? '我的收藏' : '展馆列表'}</Link></p>{!result ? <LoadingState label="加载展品详情" /> : !result.ok ? <><h1>展品{result.error.code === 'NOT_FOUND' || result.error.code === 'FORBIDDEN' ? '不可用' : '加载失败'}</h1>{result.error.code === 'NOT_FOUND' || result.error.code === 'FORBIDDEN' ? <p>内容不存在或不可公开访问。旧图像和详情已清除。</p> : <Failure message={`${result.error.code}：${result.error.message}`} retry={() => setRetry(n => n + 1)} />}</> : <>
    <h1 ref={title} tabIndex={-1}>{result.value.title}</h1><Dev client={client} exhibit={result.value} /><FavoriteButton id={id} store={store} /><Button intent="secondary" onClick={() => setRetry(n => n + 1)}>重新核验展品</Button>
    <div className="ga-detail-media">{result.value.media.map(media => <figure key={media.id}><Picture key={media.url} media={media} /><figcaption>{media.alt}</figcaption><Button intent="secondary" onClick={() => setLarge(media)}>放大图片：{media.alt}</Button></figure>)}</div>
    <dl className="ga-metadata">{[['工艺', crafts.find(c => c.id === result.value.craftId)?.name ?? result.value.craftId], ['年代 / 创作时间', result.value.dateLabel], ['地区', result.value.region], ['作者或机构', result.value.creator], ['分类', result.value.category], ['标签', result.value.tags.join('、')]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <section><h2>简介</h2><p>{result.value.summary}</p><h2>正文</h2><p className="ga-prose">{result.value.description}</p><h2>纹样寓意</h2><p>{result.value.meaning}</p></section>
    <section><h2>事实来源</h2>{result.value.sources.map((s, i) => <div key={i}><h3>{s.title}</h3><p>作者 / 机构：{s.author} · 访问日期：{s.accessedAt}</p><p>{s.citation}</p><p>{s.note}</p>{s.url && <a href={s.url} target="_blank" rel="noopener noreferrer">来源外链：{s.title}（新标签页）</a>}</div>)}</section>
    <section><h2>图像来源与媒体许可</h2>{result.value.media.map(m => <div key={m.id}><p>{m.alt} · 图像作者：{m.author}</p>{m.source && <p>图像来源：{m.source}</p>}<p>许可：{m.license.name} · 署名：{m.license.attribution}</p>{m.license.url && <a href={m.license.url} target="_blank" rel="noopener noreferrer">许可外链（新标签页）</a>}{m.modification && <p>修改说明：{m.modification}</p>}</div>)}</section>
    <Associations exhibit={result.value} client={client} navigate={navigate} />
    </>}<Dialog open={large !== null && !!result?.ok} title="展品大图" fallbackFocusRef={title} onClose={() => setLarge(null)}>{large && result?.ok && <div className="ga-large"><Picture key={large.url} media={large} large /><p>{large.alt}</p></div>}</Dialog></>;
}
function FavoritesList({ client, store, navigate, url }: GalleryPageProps & { store: GalleryFavorites }) {
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [rows, setRows] = useState<{ id: string; result: Result<Exhibit> }[] | null>(null), [retry, setRetry] = useState(0), [crafts, setCrafts] = useState<Craft[]>([]);
  const ids = state.items?.map(f => f.exhibitId).join(',') ?? null;
  useEffect(() => { const focus = () => { setRows(null); setRetry(n => n + 1); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, []);
  useEffect(() => { let active = true; void client.listCrafts().then(r => { if (active && r.ok) setCrafts(r.value); }, () => {}); return () => { active = false; }; }, [client]);
  useEffect(() => { let active = true; setRows(null); if (ids !== null) void mapLimited(ids ? ids.split(',') : [], id => verificationSlot(client, async () => { if (!active) return null; try { return { id, result: await client.getExhibit(id) }; } catch { return { id, result: { ok: false as const, error: { code: 'NETWORK_ERROR' as const, message: '核验请求失败', requestId: 'gallery', fieldErrors: [] } } }; } })).then(next => { if (active) setRows(next.filter((row): row is { id: string; result: Result<Exhibit> } => row !== null)); }); return () => { active = false; }; }, [client, ids, retry]);
  useRestore(url, rows !== null);
  return <><h1>我的收藏</h1><Dev client={client} /><p>无需账号，仅保存展品 ID 与收藏时间于此浏览器。清除站点数据会丢失收藏；收藏不复制文化内容或图片。</p><Button intent="secondary" onClick={() => { setRows(null); setRetry(n => n + 1); void store.refresh(); }}>刷新收藏并核验内容</Button>{state.items === null ? state.error ? null : <LoadingState label="读取收藏" /> : !rows ? <LoadingState label="核验收藏内容" /> : !rows.length ? <EmptyState title="还没有收藏" description="到展馆浏览并收藏感兴趣的展品。" action={<Link href="/gallery" navigate={navigate}>返回展馆</Link>} /> : <div className="ga-grid">{rows.filter(row => state.items?.some(f => f.exhibitId === row.id)).map(row => row.result.ok ? <Card key={row.id} exhibit={row.result.value} crafts={crafts} client={client} store={store} from="/my/favorites" navigate={navigate} /> : <article className="ga-card" key={row.id}><h2>{row.result.error.code === 'NOT_FOUND' || row.result.error.code === 'FORBIDDEN' ? '不可用收藏记录' : '收藏核验失败'}</h2><p>展品 ID：{row.id}</p><p>{row.result.error.code === 'NOT_FOUND' || row.result.error.code === 'FORBIDDEN' ? '内容不存在或不可公开访问，已清除旧图像。' : `${row.result.error.code}：暂不能确认内容状态；收藏引用保留。`}</p><Button onClick={() => setRetry(n => n + 1)}>重试核验</Button><FavoriteButton id={row.id} store={store} /></article>)}</div>}</>;
}
export function GalleryPage({ client, url, navigate, favorites }: GalleryPageProps) {
  const store = useMemo(() => favorites ?? new GalleryFavorites(() => openIndexedDbRepository()), [favorites]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => { void store.refresh(); const focus = () => { void store.refresh(); }; window.addEventListener('focus', focus); return () => { window.removeEventListener('focus', focus); store.dispose(); }; }, [store]);
  const path = new URL(url, location.origin).pathname;
  let id = ''; try { id = decodeURIComponent(path.slice('/gallery/'.length)); } catch { id = '!invalid'; }
  return <main className="ga-page ss-theme"><header><p>手上中国 · 数字展馆与收藏</p><nav aria-label="展馆导航"><Link href="/" navigate={navigate}>返回首页</Link><Link href="/gallery" navigate={navigate}>数字展馆</Link><Link href="/my/favorites" navigate={navigate}>我的收藏</Link></nav></header>{state.error && <InlineNotice tone="error">收藏不可用或操作失败：{state.error}。公开内容仍可浏览。<Button intent="secondary" onClick={() => { void store.refresh(); }}>重试读取收藏</Button></InlineNotice>}{path === '/my/favorites' ? <FavoritesList client={client} store={store} url={url} navigate={navigate} /> : path === '/gallery' ? <GalleryList client={client} store={store} url={url} navigate={navigate} /> : <Detail key={id} id={id} client={client} store={store} url={url} navigate={navigate} />}</main>;
}
