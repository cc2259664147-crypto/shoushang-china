import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { generateUuid } from '@shoushang/content-client';
import { Button, FormField, TextInput, TextArea, Select, StatusMessage, LoadingState, EmptyState, Dialog } from '@shoushang/ui';
import { AdminHttpError, asItems, asRecord, createAdminHttpClient } from './client';
import type { AdminClient } from './client';
import './admin.css';
type Source = {
    title: string;
    author: string;
    url: string;
    accessedAt: string;
    citation: string;
    note: string;
};
type Timeline = {
    dateLabel: string;
    text: string;
    sources: Source[];
};
type Form = {
    title: string;
    summary: string;
    craftId: string;
    craftIds: string;
    category: string;
    tags: string;
    description: string;
    region: string;
    creator: string;
    dateLabel: string;
    meaning: string;
    personName: string;
    personBio: string;
    body: string;
    storyIds: string;
    exhibitIds: string;
    templateIds: string;
    templateId: string;
    mediaIds: string[];
    sources: Source[];
    timeline: Timeline[];
    developmentOnly: boolean;
    sortOrder: string;
};
const emptyLicense = () => ({ alt: '', author: '', source: '', licenseType: '', attribution: '', licenseUrl: '', usageScope: 'site-display-and-thumbnail', kind: 'illustration' });
const source = (): Source => ({ title: '', author: '', url: '', accessedAt: new Date().toISOString().slice(0, 10), citation: '', note: '' });
function SourceFields({ sources, onChange, prefix = '' }: {
    sources: Source[];
    onChange: (value: Source[]) => void;
    prefix?: string;
}) { return <>{sources.map((s, i) => <fieldset key={i}><legend>{prefix}来源 {i + 1}</legend><div className="admin-grid">{([['title', '来源标题'], ['author', '机构或作者'], ['url', 'HTTP(S) 来源地址（可选）'], ['accessedAt', '查阅日期 YYYY-MM-DD'], ['citation', '引用位置'], ['note', '来源说明']] as const).map(([k, label]) => <FormField key={k} label={prefix + label}>{p => <TextInput {...p} value={s[k]} onChange={e => onChange(sources.map((x, n) => n === i ? { ...x, [k]: e.target.value } : x))}/>}</FormField>)}</div><Button intent="ghost" onClick={() => onChange(sources.filter((_, n) => n !== i))}>移除{prefix}来源 {i + 1}</Button></fieldset>)}<Button intent="secondary" onClick={() => onChange([...sources, source()])}>添加{prefix}来源</Button></>; }
function sourceForms(value: unknown): Source[] { return Array.isArray(value) ? value.map(x => ({ ...source(), ...asRecord(x), accessedAt: String(asRecord(x).accessedAt ?? '').slice(0, 10) }) as Source) : []; }
function sourcePayload(sources: Source[]) { return sources.map(x => Object.fromEntries(Object.entries({ ...x, accessedAt: x.accessedAt ? new Date(x.accessedAt + 'T00:00:00Z').toISOString() : '' }).filter(([, v]) => v.trim() !== ''))); }
const empty = (): Form => ({ title: '', summary: '', craftId: '', craftIds: '', category: '', tags: '', description: '', region: '', creator: '', dateLabel: '未注明', meaning: '', personName: '', personBio: '', body: '', storyIds: '', exhibitIds: '', templateIds: '', templateId: '', mediaIds: [], sources: [], timeline: [], developmentOnly: true, sortOrder: '0' });
const csv = (s: string) => s.split(/[,，\s]+/u).map(x => x.trim()).filter(Boolean);
function fromDraft(d: Record<string, unknown>): Form { const f = empty(); for (const k of Object.keys(f) as (keyof Form)[])
    if (typeof f[k] === 'string' && typeof d[k] === 'string')
        (f as unknown as Record<string, unknown>)[k] = d[k]; for (const k of ['craftIds', 'tags', 'storyIds', 'exhibitIds', 'templateIds'] as const)
    if (Array.isArray(d[k]))
        f[k] = (d[k] as unknown[]).join(', '); f.sortOrder = String(d.sortOrder ?? 0); f.developmentOnly = d.developmentOnly !== false; f.body = Array.isArray(d.body) ? d.body.map(x => String(asRecord(x).text ?? '')).join('\n\n') : ''; f.sources = sourceForms(d.sources); f.timeline = Array.isArray(d.timeline) ? d.timeline.map(x => ({ dateLabel: String(asRecord(x).dateLabel ?? ''), text: String(asRecord(x).text ?? ''), sources: sourceForms(asRecord(x).sources) })) : []; const media = (Array.isArray(d.media) ? d.media : d.cover ? [d.cover] : []); f.mediaIds = media.map(x => String(asRecord(x).id)); return f; }
function payload(f: Form, kind: string) {
    const s = sourcePayload(f.sources);
    const common: Record<string, unknown> = { developmentOnly: f.developmentOnly, sortOrder: Number(f.sortOrder), mediaIds: f.mediaIds };
    for (const k of ['title', 'summary', 'region'] as const)
        if (f[k].trim())
            common[k] = f[k].trim();
    if (s.length)
        common.sources = s;
    if (kind === 'exhibit') {
        for (const k of ['craftId', 'category', 'description', 'creator', 'dateLabel', 'meaning'] as const)
            if (f[k].trim())
                common[k] = f[k].trim();
        Object.assign(common, { tags: csv(f.tags), storyIds: csv(f.storyIds), templateIds: csv(f.templateIds) });
    }
    else {
        for (const k of ['personName', 'personBio', 'templateId'] as const)
            if (f[k].trim())
                common[k] = f[k].trim();
        if (f.body.trim())
            common.body = f.body.split(/\n\s*\n/u).filter(Boolean).map(text => ({ type: 'paragraph', text }));
        Object.assign(common, { ...(csv(f.craftIds).length ? { craftIds: csv(f.craftIds) } : {}), exhibitIds: csv(f.exhibitIds), timeline: f.timeline.map(t => ({ ...Object.fromEntries(Object.entries({ dateLabel: t.dateLabel, text: t.text }).filter(([, v]) => v.trim() !== '')), sources: sourcePayload(t.sources) })) });
    }
    return common;
}
export function AdminPage({ client: provided }: {
    client?: AdminClient;
}) {
    const [client] = useState(() => provided ?? createAdminHttpClient());
    const [account, setAccount] = useState<Record<string, unknown> | null>(null);
    const seenAccount = useRef<string | null>(null);
    const [initial, setInitial] = useState(true);
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [tab, setTab] = useState('contents');
    const [items, setItems] = useState<Record<string, unknown>[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState('');
    const [query, setQuery] = useState('');
    const [stateFilter, setStateFilter] = useState('');
    const [kind, setKind] = useState('exhibit');
    const [content, setContent] = useState<Record<string, unknown> | null>(null);
    const [form, setForm] = useState<Form>(empty);
    const [editing, setEditing] = useState(false);
    const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
    const [history, setHistory] = useState<Record<string, unknown>[]>([]);
    const [vocab, setVocab] = useState<Record<string, unknown>>({});
    const [media, setMedia] = useState<Record<string, unknown>[]>([]);
    const [sourcesEvidence, setSourcesEvidence] = useState('');
    const [identityEvidence, setIdentityEvidence] = useState('');
    const [quotationEvidence, setQuotationEvidence] = useState('');
    const [confirm, setConfirm] = useState<{
        title: string;
        run: () => Promise<void>;
    } | null>(null);
    const [reason, setReason] = useState('');
    const reasonRef = useRef(reason);
    reasonRef.current = reason;
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [proofFile, setProofFile] = useState<File | null>(null);
    const [selectedMedia, setSelectedMedia] = useState<Record<string, unknown> | null>(null);
    const [license, setLicense] = useState(emptyLicense);
    const [backup, setBackup] = useState<Record<string, unknown> | null>(null);
    function acceptAccount(value:unknown) {
        const a=asRecord(value);
        if(seenAccount.current!==null&&seenAccount.current!==String(a.id)) {
            setTab('contents');setItems([]);setMedia([]);setVocab({});setSelectedMedia(null);setEditing(false);setContent(null);setForm(empty());setPreview(null);setHistory([]);setBackup(null);setLicense(emptyLicense());setProofFile(null);setUploadFile(null);
        }
        seenAccount.current=String(a.id);setAccount(a);
    }
    function report(e: unknown) { setMessage(''); if (e instanceof AdminHttpError) {
        setError(`${e.message}（请求 ${e.detail.requestId}）`);
        setFieldErrors(Object.fromEntries(e.detail.fieldErrors.map(f => [f.path, f.message])));
        if (e.status === 401)
            {setAccount(null);setTab('contents');setItems([]);setSelectedMedia(null);setLicense(emptyLicense());}
    }
    else
        setError(e instanceof Error ? e.message : '操作未完成，请重试'); }
    async function perform(fn: () => Promise<void>) { if (lock.current)
        return; lock.current = true; setBusy(true); setError(''); setFieldErrors({}); setMessage(''); try {
        await fn();
    }
    catch (e) {
        report(e);
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    useEffect(() => { let live = true; client.session().then(s => { if (live)
        acceptAccount(s.account); }).catch(e => { if (live && !(e instanceof AdminHttpError && e.status === 401))
        report(e); }).finally(() => { if (live)
        setInitial(false); }); return () => { live = false; }; }, [client]);
    async function load() {
        if (tab === 'contents') {
            const q = new URLSearchParams({ page: String(page), pageSize: '12', ...(query ? { q: query } : {}), ...(stateFilter ? { state: stateFilter } : {}) });
            const p = await client.call('GET', '/contents?' + q);
            setItems(asItems(p));
            setTotal(Number(asRecord(p).total));
            const [v, m] = await Promise.all([client.call('GET', '/vocabulary'), client.call('GET', '/media?pageSize=50')]);
            setVocab(asRecord(v));
            setMedia(asItems(m));
        }
        else if (tab === 'media') {
            const p = await client.call('GET', `/media?page=${page}`);
            setItems(asItems(p));
            setTotal(Number(asRecord(p).total));
        }
        else if (tab === 'audit' || tab === 'accounts') {
            const p = await client.call('GET', `/${tab}?page=${page}`);
            setItems(asItems(p));
            setTotal(Number(asRecord(p).total));
        }
    }
    useEffect(() => { if (account)
        void perform(load); }, [account, tab, page, query, stateFilter]);
    const set = <K extends keyof Form>(k: K, value: Form[K]) => setForm(f => ({ ...f, [k]: value }));
    function field(label: string, k: Exclude<keyof Form, 'mediaIds' | 'sources' | 'timeline' | 'developmentOnly'>, multiline = false) { return <FormField key={k} label={label} error={fieldErrors[k] ?? ''}>{p => multiline ? <TextArea {...p} value={String(form[k])} onChange={e => set(k, e.target.value)}/> : <TextInput {...p} value={String(form[k])} onChange={e => set(k, e.target.value)}/>}</FormField>; }
    async function openContent(row: Record<string, unknown>) { const k = String(row.kind), id = String(row.id); const c = asRecord(await client.call('GET', `/contents/${k}/${id}`)); setKind(k); setContent(c); setForm(fromDraft(asRecord(c.draft))); setEditing(true); setPreview(null); setHistory([]); setSourcesEvidence(''); setIdentityEvidence(''); setQuotationEvidence(''); }
    async function save() { const d = payload(form, kind); const result = asRecord(await client.call('POST', content ? `/contents/${kind}/${content.id}/revisions` : '/contents', content ? { draft: d, expectedLatest: content.latestRevision } : { kind, draft: d, expectedLatest: null })); await openContent({ kind, id: result.id }); await load(); setMessage('草稿已持久保存，尚未发布。'); }
    async function refreshContent() { if (content)
        await openContent({ kind, id: content.id }); await load(); }
    function ask(title: string, run: (operationKey: string) => Promise<void>) { const operationKey = generateUuid(); setReason(''); setConfirm({ title, run: () => run(operationKey) }); }
    function adminAction(op: string) { if (!content)
        return; const current = content; ask(op === 'publish' ? '确认发布' : op === 'unpublish' ? '确认下架' : '确认操作', async (operationKey) => { if (!reasonRef.current.trim())
        throw new Error('请填写操作原因'); const body = op === 'publish' ? { revision: current.revision, expectedLatest: current.latestRevision, expectedPublic: current.publicRevision, reviewId: asRecord(current.review ?? {}).id } : { expectedLatest: current.latestRevision, expectedPublic: current.publicRevision, reason: reasonRef.current }; await client.call('POST', `/contents/${kind}/${current.id}/${op}`, body, operationKey); await refreshContent(); setMessage(op === 'publish' ? '发布成功。' : '下架成功，后续公开读取不可见。'); }); }
    const canAdmin = account?.role === 'admin';
    const pages = <div className="admin-pagination"><Button intent="secondary" disabled={busy || page === 1} onClick={() => setPage(p => p - 1)}>上一页</Button><span>第 {page} 页 · 共 {total} 条</span><Button intent="secondary" disabled={busy || page * 12 >= total} onClick={() => setPage(p => p + 1)}>下一页</Button></div>;
    const shell = (children: ReactNode) => <main className="ss-theme admin-shell"><header><p className="admin-kicker">手上中国 · 内容管理模块</p><h1>内容后台</h1><p>独立模块，待总控集成。文化事实与媒体许可需要人工核验。</p>{account && <p>{String(account.username)} · {canAdmin ? '管理员' : '内容编辑'} <Button intent="ghost" disabled={busy} onClick={() => void perform(async () => { await client.logout(); setAccount(null); setPassword(''); setTab('contents'); setItems([]); setMedia([]); setVocab({}); setSelectedMedia(null); setEditing(false); setContent(null); setForm(empty()); setPreview(null); setHistory([]); setBackup(null); setLicense(emptyLicense()); setProofFile(null); setUploadFile(null); setMessage('已退出，会话已撤销。'); })}>退出登录</Button></p>}</header><StatusMessage tone="error" message={error} urgent/><StatusMessage tone="success" message={message}/>{busy && <LoadingState label="正在等待服务器确认"/>}{children}<Dialog open={!!confirm} title={confirm?.title ?? '确认操作'} busy={busy} onClose={() => { if (!busy)
        setConfirm(null); }} actions={<><Button intent="secondary" disabled={busy} onClick={() => setConfirm(null)}>取消</Button><Button intent="danger" loading={busy} onClick={() => void perform(async () => { await confirm?.run(); setConfirm(null); })}>确认执行</Button></>}><FormField label="操作原因">{p => <TextArea {...p} value={reason} onChange={e => setReason(e.target.value)}/>}</FormField><p>只有服务器确认后才会显示成功；失败时保留当前输入。</p></Dialog></main>;
    if (initial)
        return shell(<LoadingState label="正在核验后台会话"/>);
    if (!account)
        return shell(<form className="admin-login" onSubmit={(e: FormEvent) => { e.preventDefault(); void perform(async () => { const s = await client.login(username, password); acceptAccount(s.account); setPassword(''); setMessage('已登录。'); }); }}><h2>受控账号登录</h2><FormField label="账号">{p => <TextInput {...p} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}/>}</FormField><FormField label="密码">{p => <TextInput {...p} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/>}</FormField><Button type="submit" loading={busy}>登录</Button><p>账号由部署维护者预置；无公开注册和自助重置。</p></form>);
    return shell(<><nav aria-label="后台功能" className="admin-tabs">{[['contents', '内容'], ['media', '媒体许可'], ...(canAdmin ? [['audit', '操作记录'], ['accounts', '账号管理'], ['backups', '备份']] : [])].map(([value, label]) => <Button key={value} intent={tab === value ? 'primary' : 'secondary'} disabled={busy} onClick={() => { setTab(value!); setPage(1); }}>{label}</Button>)}</nav>
    {tab === 'contents' && <><section><h2>内容列表</h2><form className="admin-filters" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(filter); }}><FormField label="标题关键词">{p => <TextInput {...p} value={filter} onChange={e => setFilter(e.target.value)}/>}</FormField><FormField label="内容状态">{p => <Select {...p} value={stateFilter} options={[{ value: '', label: '全部' }, ...['draft', 'pending', 'published', 'withdrawn'].map(value => ({ value, label: ({ draft: '草稿', pending: '待审核', published: '已发布', withdrawn: '已下架' }[value]!) }))]} onChange={e => { setStateFilter(e.target.value); setPage(1); }}/>}</FormField><Button type="submit" disabled={busy}>筛选</Button><Button disabled={busy} onClick={() => { setContent(null); setForm(empty()); setEditing(true); setPreview(null); }}>新建草稿</Button><Button intent="secondary" disabled={busy} onClick={() => void perform(load)}>重新读取列表</Button></form>{items.length ? <ul className="admin-list">{items.map(r => <li key={String(r.id)}><div><strong>{String(r.title)}</strong><p>{String(r.kind)} · {String(r.state)} · 修订 {String(r.revision)} · 公开版 {String(r.publicRevision ?? '无')}</p></div><Button disabled={busy} onClick={() => void perform(() => openContent(r))}>编辑与审核</Button></li>)}</ul> : <EmptyState title="暂无内容" description="调整筛选条件或创建草稿。"/>}{pages}</section>
    {editing && <section className="admin-editor"><h2>{content ? `编辑修订 ${String(content.revision)} / 公开 ${String(content.publicRevision ?? '无')}` : '创建草稿'}</h2>{!content && <FormField label="内容类型">{p => <Select {...p} value={kind} options={[{ value: 'exhibit', label: '展品' }, { value: 'story', label: '故事' }]} onChange={e => setKind(e.target.value)}/>}</FormField>}<div className="admin-grid">{field('标题', 'title')}{field('摘要', 'summary', true)}{field('地区', 'region')}{field('排序', 'sortOrder')}
      {kind === 'exhibit' ? <><FormField label="工艺">{p => <Select {...p} value={form.craftId} options={[{ value: '', label: '请选择' }, ...(Array.isArray(vocab.crafts) ? vocab.crafts.map(x => { const r = asRecord(x); return { value: String(r.id), label: String(r.name) }; }) : [])]} onChange={e => set('craftId', e.target.value)}/>}</FormField><FormField label="分类">{p => <Select {...p} value={form.category} options={[{ value: '', label: '请选择' }, ...(Array.isArray(vocab.categories) ? vocab.categories.map(x => ({ value: String(x), label: String(x) })) : [])]} onChange={e => set('category', e.target.value)}/>}</FormField><FormField label="标签（从词表选择）">{() => <div>{(Array.isArray(vocab.tags) ? vocab.tags : []).map(t => <label key={String(t)}><input type="checkbox" checked={csv(form.tags).includes(String(t))} onChange={e => set('tags', (e.target.checked ? [...csv(form.tags), String(t)] : csv(form.tags).filter(x => x !== t)).join(','))}/>{String(t)}</label>)}</div>}</FormField>{field('主体介绍', 'description', true)}{field('创作者', 'creator')}{field('年代（未知写未注明）', 'dateLabel')}{field('纹样寓意与依据', 'meaning', true)}{field('关联故事 ID（逗号分隔）', 'storyIds')}{field('关联模板 ID（逗号分隔）', 'templateIds')}</> : <>{field('人物姓名', 'personName')}{field('人物简介', 'personBio', true)}{field('工艺 ID（逗号分隔）', 'craftIds')}{field('正文（空行分段，纯文本）', 'body', true)}{field('关联展品 ID（逗号分隔）', 'exhibitIds')}{field('关联模板 ID', 'templateId')}</>}
      <FormField label={kind === 'story' ? '封面媒体' : '配图媒体'} error={fieldErrors.media ?? ''}>{() => <div>{media.map(m => <label key={String(m.id)} className="admin-media-choice"><input type={kind === 'story' ? 'radio' : 'checkbox'} name="content-media" checked={form.mediaIds.includes(String(m.id))} onChange={e => set('mediaIds', kind === 'story' ? [String(m.id)] : e.target.checked ? [...form.mediaIds, String(m.id)] : form.mediaIds.filter(x => x !== m.id))}/>{String(asRecord(m.license).alt ?? m.id)} · {String(m.state)}</label>)}</div>}</FormField><label><input type="checkbox" checked={form.developmentOnly} onChange={e => set('developmentOnly', e.target.checked)}/>开发示意，不计正式内容数量</label></div>
      <h3>事实来源</h3><SourceFields sources={form.sources} onChange={value => set('sources', value)}/>
            {kind === 'story' && <><h3>经核实的时间线</h3>{form.timeline.map((t, i) => <fieldset key={i}><FormField label={`节点 ${i + 1} 日期`}>{p => <TextInput {...p} value={t.dateLabel} onChange={e => set('timeline', form.timeline.map((x, n) => n === i ? { ...x, dateLabel: e.target.value } : x))}/>}</FormField><FormField label={`节点 ${i + 1} 内容`}>{p => <TextArea {...p} value={t.text} onChange={e => set('timeline', form.timeline.map((x, n) => n === i ? { ...x, text: e.target.value } : x))}/>}</FormField><SourceFields prefix={`节点 ${i + 1} `} sources={t.sources} onChange={sources => set('timeline', form.timeline.map((x, n) => n === i ? { ...x, sources } : x))}/><p>节点来源单独维护，不自动替换为正文来源。</p><Button intent="ghost" onClick={() => set('timeline', form.timeline.filter((_, n) => n !== i))}>移除节点</Button></fieldset>)}<Button intent="secondary" onClick={() => set('timeline', [...form.timeline, { dateLabel: '', text: '', sources: [] }])}>添加节点</Button></>}
      <div className="admin-actions"><Button loading={busy} onClick={() => void perform(save)}>保存新草稿修订</Button>{content && <><Button disabled={busy} onClick={() => void perform(async () => { setPreview(asRecord(await client.call('GET', `/contents/${kind}/${content.id}/preview?revision=${content.revision}`))); })}>预览已保存修订</Button><Button disabled={busy || content.state !== 'draft'} onClick={() => void perform(async () => { await client.call('POST', `/contents/${kind}/${content.id}/submit`, { revision: content.revision, expectedLatest: content.latestRevision }); await refreshContent(); setMessage('已提交审核。'); })}>提交审核</Button><Button intent="secondary" disabled={busy} onClick={() => void perform(refreshContent)}>重新读取修订（替换表单）</Button><Button intent="secondary" disabled={busy} onClick={() => { setContent(null); setMessage('已保留表单，下一次保存将创建独立副本。'); }}>保留输入另建副本</Button></>}</div>
      {preview && <article className="admin-preview"><h3>鉴权预览 · 保存修订 {String(preview.revision)}</h3><h4>{String(asRecord(preview.draft).title ?? '未命名')}</h4><p>{String(asRecord(preview.draft).summary ?? '')}</p><p>{String(asRecord(preview.draft).description ?? '')}</p>{Array.isArray(asRecord(preview.draft).body) && (asRecord(preview.draft).body as unknown[]).map((p, i) => <p key={i}>{String(asRecord(p).text)}</p>)}{(Array.isArray(asRecord(preview.draft).media) ? asRecord(preview.draft).media as unknown[] : asRecord(preview.draft).cover ? [asRecord(preview.draft).cover] : []).map(m => { const image = asRecord(m); return <img key={String(image.id)} src={`/api/v1/admin/media/${image.id}/thumbnail`} alt={String(image.alt)}/>; })}</article>}
      {canAdmin && content && <div className="admin-review"><h3>管理员核验</h3><FormField label="来源核验依据">{p => <TextArea {...p} value={sourcesEvidence} onChange={e => setSourcesEvidence(e.target.value)}/>}</FormField>{kind === 'story' && <><FormField label="人物身份核验依据">{p => <TextArea {...p} value={identityEvidence} onChange={e => setIdentityEvidence(e.target.value)}/>}</FormField><FormField label="引用核验依据（无引语也须说明）">{p => <TextArea {...p} value={quotationEvidence} onChange={e => setQuotationEvidence(e.target.value)}/>}</FormField></>}<div className="admin-actions">{['approved', 'rejected'].map(decision => <Button key={decision} disabled={busy || content.state !== 'pending'} onClick={() => void perform(async () => { await client.call('POST', `/contents/${kind}/${content.id}/review`, { revision: content.revision, expectedLatest: content.latestRevision, decision, evidence: { sources: sourcesEvidence, ...(kind === 'story' ? { identity: identityEvidence, quotations: quotationEvidence } : {}) } }); await refreshContent(); setMessage(decision === 'approved' ? '核验记录已保存，可确认发布。' : '已记录退回，修改需创建新修订。'); })}>{decision === 'approved' ? '记录核验通过' : '记录退回'}</Button>)}<Button disabled={busy || content.state !== 'pending' || asRecord(content.review ?? {}).decision !== 'approved'} onClick={() => adminAction('publish')}>审核发布</Button><Button intent="danger" disabled={busy || content.publicRevision === null} onClick={() => adminAction('unpublish')}>下架</Button><Button intent="secondary" disabled={busy} onClick={() => void perform(async () => setHistory(asItems(await client.call('GET', `/contents/${kind}/${content.id}/history?pageSize=50`))))}>查看历史</Button></div>{history.map(h => <p key={String(h.revision)}>修订 {String(h.revision)} · {String(h.state)} <Button disabled={busy} onClick={() => ask('恢复历史为新草稿', async (operationKey) => { await client.call('POST', `/contents/${kind}/${content.id}/restore`, { sourceRevision: h.revision, expectedLatest: content.latestRevision, reason: reasonRef.current }, operationKey); await refreshContent(); setMessage('已建立恢复草稿，须重新审核发布。'); })}>恢复为新草稿</Button></p>)}</div>}
    </section>}</>}
    {tab === 'media' && <section><h2>媒体与授权台账</h2><p>仅JPEG/PNG/WebP，单文件5MB以内，尺寸不超过6000×6000。许可凭证仅上传者与管理员可见。</p><FormField label="选择图片">{p => <input {...p} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setUploadFile(e.target.files?.[0] ?? null)}/>}</FormField><Button loading={busy} disabled={!uploadFile} onClick={() => void perform(async () => { const m = asRecord(await client.call('POST', '/media', uploadFile)); setSelectedMedia(m); setLicense(emptyLicense()); await load(); setMessage('图片和真实缩略图已保存，尚未获准公开。'); })}>上传图片</Button><ul className="admin-list">{items.map(m => <li key={String(m.id)}><div>{String(m.id)} · {String(m.state)} · 修订 {String(m.revision)}</div><Button disabled={busy} onClick={() => { setSelectedMedia(m); setLicense({ ...emptyLicense(), ...asRecord(m.license ?? {}) }); }}>维护许可</Button></li>)}</ul>{pages}
    {selectedMedia && <div><h3>许可字段 · {String(selectedMedia.id)} · 修订 {String(selectedMedia.revision)}</h3><div className="admin-grid">{([['alt', '替代文本'], ['author', '作者'], ['source', '图片来源及依据'], ['licenseType', '许可类型'], ['attribution', '署名要求'], ['licenseUrl', '内部许可地址（可选）']] as const).map(([k, label]) => <FormField key={k} label={label}>{p => <TextInput {...p} value={license[k]} onChange={e => setLicense(x => ({ ...x, [k]: e.target.value }))}/>}</FormField>)}<FormField label="图片性质">{p => <Select {...p} value={license.kind} options={[{ value: 'illustration', label: '示意图' }, { value: 'photograph', label: '真实照片' }]} onChange={e => setLicense(x => ({ ...x, kind: e.target.value }))}/>}</FormField><p>申请范围：网站展示和缩略图（site-display-and-thumbnail）</p></div><Button disabled={busy} onClick={() => void perform(async () => { const { licenseUrl, ...rest } = license; const v = asRecord(await client.call('PATCH', `/media/${selectedMedia.id}/license`, { ...rest, ...(licenseUrl.trim() ? { licenseUrl } : {}), expectedRevision: selectedMedia.revision })); setSelectedMedia(x => ({ ...x, ...v })); await load(); setMessage('许可字段已保存。'); })}>保存许可</Button><FormField label="许可凭证图片">{p => <input {...p} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setProofFile(e.target.files?.[0] ?? null)}/>}</FormField><Button disabled={busy || !proofFile} onClick={() => void perform(async () => { const v = asRecord(await client.call('PUT', `/media/${selectedMedia.id}/proof`, proofFile)); setSelectedMedia(x => ({ ...x, ...v })); await load(); setMessage('私有凭证已保存。'); })}>上传私有凭证</Button><p><a href={`/api/v1/admin/media/${selectedMedia.id}/proof`} target="_blank" rel="noreferrer">经授权查看凭证</a></p>{canAdmin && <div className="admin-actions"><Button disabled={busy} onClick={() => ask('确认媒体许可核验', async () => { const v = asRecord(await client.call('POST', `/media/${selectedMedia.id}/review`, { expectedRevision: selectedMedia.revision, decision: 'approved', reason: reasonRef.current, verifiedScope: 'site-display-and-thumbnail' })); setSelectedMedia(x => ({ ...x, ...v })); await load(); setMessage('媒体许可核验已记录。'); })}>核验媒体许可</Button><Button intent="danger" disabled={busy} onClick={() => ask('撤销媒体授权', async (operationKey) => { await client.call('POST', `/media/${selectedMedia.id}/revoke`, { expectedRevision: selectedMedia.revision, reason: reasonRef.current }, operationKey); await load(); setMessage('已撤权，后续媒体读取将被拒绝。已下载文件无法收回。'); })}>撤权</Button></div>}</div>}</section>}
    {tab === 'audit' && <section><h2>操作记录</h2>{items.length ? <ul className="admin-list">{items.map(r => <li key={String(r.sequence)}><div><strong>{String(r.action)} · {String(r.result)}</strong><p>对象 {String(r.targetId)} · 修订 {String(r.revision ?? '—')} · 操作者 {String(r.actorId)}</p><p>{new Date(String(r.createdAt)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · 请求 {String(r.requestId)}</p></div></li>)}</ul> : <EmptyState title="暂无记录" description="真实操作后将留下审计记录。"/>}{pages}</section>}
    {tab === 'accounts' && <section><h2>账号停用</h2><p>初始化、密码重置由部署维护者通过受控本机命令完成。</p><ul className="admin-list">{items.map(r => <li key={String(r.id)}><div>{String(r.username)} · {String(r.role)} · {r.disabled ? '已停用' : '启用'}</div><Button intent="danger" disabled={busy || !!r.disabled || r.id === account.id} onClick={() => ask('确认停用账号', async (operationKey) => { await client.call('POST', `/accounts/${r.id}/disable`, { expectedVersion: r.version, reason: reasonRef.current }, operationKey); await load(); setMessage('账号已停用，旧会话立即失效。'); })}>停用账号</Button></li>)}</ul>{pages}</section>}
    {tab === 'backups' && <section><h2>受控备份</h2><p>包含数据库、媒体和私有许可凭证；执行期间阻止写入。恢复仅由部署维护者离线执行。</p><Button disabled={busy} onClick={() => ask('建立备份任务', async (operationKey) => { const v = asRecord(await client.call('POST', '/backups', { reason: reasonRef.current }, operationKey)); setBackup(v); setMessage('已接受备份任务，尚未确认成功。'); })}>创建备份</Button>{backup && <><p>任务 {String(backup.jobId)} · {String(backup.state)}</p><Button disabled={busy} onClick={() => void perform(async () => { const v = asRecord(await client.call('GET', `/backups/${backup.jobId}`)); setBackup(v); setMessage(v.state === 'succeeded' ? '数据库与媒体备份已校验完成。' : v.state === 'failed' ? '备份失败，请交维护者处理。' : '备份仍在处理中。'); })}>查询任务结果</Button></>}</section>}
  </>);
}
