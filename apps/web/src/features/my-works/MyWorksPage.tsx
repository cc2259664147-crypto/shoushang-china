import { useCallback, useEffect, useRef, useState } from 'react';
import type { Work, WorkV2 } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
import { createArtworkRenderer, createArtworkRendererV2 } from '@shoushang/artwork-renderer';
import { createArtworkExporter, createArtworkExporterV2 } from '@shoushang/artwork-exporter';
import { openIndexedDbRepository } from '@shoushang/local-repository';
import type { IndexedDbRepository, RecordIssue } from '@shoushang/local-repository';
import { Button, Dialog, InlineNotice } from '@shoushang/ui';
import { EDITOR_PROFILE_REGISTRY_V2 } from '../workshop';
import {
  canCopySelection, canRename, copyName, entryHistoricalMode, entrySchemaVersion, entryVersions, filterWorks,
  isReadExportOnly, loadWorks, selectVersion, shownVersion,
} from './model';
import type { EntrySelection, EntryVersion, Filter, WorkEntry } from './model';
import './my-works.css';

const rendererV1 = createArtworkRenderer();
const rendererV2 = createArtworkRendererV2();
const exporterV1 = createArtworkExporter();
const exporterV2 = createArtworkExporterV2();

let thumbnailTasks = 0;
const thumbnailQueue: (() => void)[] = [];
async function limitedThumbnail<T>(task: () => Promise<T>): Promise<T> {
  if (thumbnailTasks >= 3) await new Promise<void>(resolve => thumbnailQueue.push(resolve));
  else thumbnailTasks++;
  try { return await task(); }
  finally { const next = thumbnailQueue.shift(); if (next) next(); else thumbnailTasks--; }
}

const dateText = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
function sourceLabel(version: EntryVersion) { return version === 'draft' ? '编辑草稿' : version === 'stored-draft' ? '主记录草稿' : '完成版'; }
function statusText(entry: WorkEntry) {
  return entry.draft && entry.work?.work.status === 'completed' ? '已完成 · 有编辑草稿'
    : entry.draft && entry.work?.work.status === 'draft' ? '主记录草稿 · 有编辑草稿'
      : entry.draft ? '草稿' : entry.work?.work.status === 'draft' ? '草稿' : '已完成';
}
function versionText(entry: WorkEntry) {
  const schema = entrySchemaVersion(entry);
  const mode = entryHistoricalMode(entry);
  return `v${schema ?? '?'}${mode ? ` · ${mode}` : ''}`;
}

function renderThumbnailSvg(selection: EntrySelection) {
  return selection.schemaVersion === 1
    ? rendererV1.render({ work: selection.work, width: 480, height: 480, view: 'unfolded' })
    : rendererV2.render({ work: selection.work, width: 480, height: 480, view: 'unfolded' });
}
async function thumbnailBlob(selection: EntrySelection): Promise<Blob> {
  const output = renderThumbnailSvg(selection);
  if (!output.ok) throw new Error(output.error.message);
  const svgUrl = URL.createObjectURL(new Blob([output.value.svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 480;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 不可用');
    context.drawImage(image, 0, 0, 480, 480);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('缩略图生成失败');
    return blob;
  } finally { URL.revokeObjectURL(svgUrl); }
}

function Thumbnail({ repo, entry, version }: { repo: IndexedDbRepository; entry: WorkEntry; version: EntryVersion }) {
  const [preview, setPreview] = useState<{ url: string; status: string } | null>(null);
  useEffect(() => {
    let active = true, url: string | null = null;
    void (async () => {
      try {
        const selection = selectVersion(entry, version);
        let blob: Blob, status = '';
        if (version === 'completed') {
          const stored = await repo.readAnyThumbnail(entry.id);
          if (stored.ok && stored.value.state === 'ready' && stored.value.workRevision === selection.work.revision && stored.value.blob) {
            blob = stored.value.blob; status = '完成版缩略图';
          } else {
            status = stored.ok ? '缩略图待重建' : stored.error.code === 'NOT_FOUND' ? '缩略图缺失，正在重建' : '缩略图损坏，正在重建';
            blob = await limitedThumbnail(() => thumbnailBlob(selection));
            const rebuilt = selection.schemaVersion === 1
              ? await repo.rebuildThumbnail(entry.id, selection.work.revision, blob)
              : await repo.rebuildV2Thumbnail(entry.id, selection.work.revision, blob);
            if (!rebuilt.ok) status = rebuilt.error.code === 'REVISION_CONFLICT' ? '版本已变化，请刷新列表' : '缩略图重建失败';
            else status = '完成版缩略图已重建';
          }
        } else {
          blob = await limitedThumbnail(() => thumbnailBlob(selection));
          status = '编辑草稿预览';
        }
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, status });
      } catch { if (active) setPreview({ url: '', status: '预览生成失败，可重试刷新' }); }
    })();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [repo, entry, version]);
  return <div className="mw-thumb">{preview?.url ? <img src={preview.url} alt={`${sourceLabel(version)}预览`} /> : <div className="mw-thumb-empty">{preview?.status ?? '正在加载预览'}</div>}<small>{preview?.status ?? '正在加载预览'}</small></div>;
}

async function backupJson(repo: IndexedDbRepository): Promise<Blob> {
  const result = await repo.exportRawBackup();
  if (!result.ok) throw new Error(result.error.message);
  const convert = async (value: unknown): Promise<unknown> => {
    if (value instanceof Blob) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { __type: 'Blob', mimeType: value.type, base64: btoa(binary) };
    }
    if (Array.isArray(value)) return Promise.all(value.map(convert));
    if (value && typeof value === 'object') {
      const obj: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) obj[key] = await convert(item);
      return obj;
    }
    return value;
  };
  return new Blob([JSON.stringify(await convert(result.value), null, 2)], { type: 'application/json' });
}

interface CopyAttempt {
  readonly sourceId: string;
  readonly version: EntryVersion;
  readonly schemaVersion: 1 | 2;
  readonly target: Work | WorkV2;
}

export function MyWorksPage({ onOpen, onCreate, onExit, databaseName }: { onOpen: (id: string, version: EntryVersion) => void; onCreate: () => void; onExit: () => void; databaseName?: string }) {
  const [repo, setRepo] = useState<IndexedDbRepository | null>(null), [entries, setEntries] = useState<WorkEntry[]>([]), [issues, setIssues] = useState<RecordIssue[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<Filter>('all'), [page, setPage] = useState(1), [active, setActive] = useState<WorkEntry | null>(null), [version, setVersion] = useState<EntryVersion>('draft'), [dialog, setDialog] = useState<'rename' | 'delete' | 'export' | null>(null), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [exportUrl, setExportUrl] = useState<{ url: string; filename: string } | null>(null);
  const repoRef = useRef<IndexedDbRepository | null>(null), requestId = useRef(0), lock = useRef(false), copyAttempt = useRef<CopyAttempt | null>(null), exportTicket = useRef(0), exportRef = useRef<{ url: string; filename: string } | null>(null);

  const refresh = useCallback(async (connection: IndexedDbRepository) => {
    const ticket = ++requestId.current;
    setPhase('loading');
    try {
      const data = await loadWorks(connection);
      if (ticket !== requestId.current) return;
      setEntries(data.entries); setIssues(data.issues); setPhase('ready'); setError('');
    } catch (e) {
      if (ticket === requestId.current) { setPhase('error'); setError(e instanceof Error ? e.message : '读取失败'); }
    }
  }, []);

  useEffect(() => {
    let live = true;
    const versionChanged = () => { requestId.current++; repoRef.current = null; setRepo(null); setPhase('error'); setError('数据库版本已变化，请重新连接。'); };
    const reopen = async () => {
      if (!live || repoRef.current) return;
      setPhase('loading');
      const opened = await openIndexedDbRepository({ ...(databaseName ? { name: databaseName } : {}), v2ProfileRegistry: EDITOR_PROFILE_REGISTRY_V2, onVersionChange: versionChanged });
      if (!live) { if (opened.ok) opened.value.close(); return; }
      if (!opened.ok) { setPhase('error'); setError(opened.error.message); return; }
      repoRef.current = opened.value; setRepo(opened.value); await refresh(opened.value);
    };
    void reopen();
    const focus = () => { if (repoRef.current) void refresh(repoRef.current); else void reopen(); };
    window.addEventListener('focus', focus);
    return () => { live = false; requestId.current++; exportTicket.current++; window.removeEventListener('focus', focus); repoRef.current?.close(); repoRef.current = null; };
  }, [databaseName, refresh]);

  useEffect(() => () => { if (exportRef.current) URL.revokeObjectURL(exportRef.current.url); }, []);

  const visible = filterWorks(entries, filter), pageSize = 12, pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const pageItems = visible.slice((page - 1) * pageSize, page * pageSize);

  function chooseFilter(next: Filter) { requestId.current++; setFilter(next); setPage(1); if (repo) void refresh(repo); }
  function openDialog(kind: 'rename' | 'delete' | 'export', entry: WorkEntry, source: EntryVersion) {
    setActive(entry); setVersion(source); setName(entry.draft?.work.name ?? entry.work?.work.name ?? ''); setDialog(kind); setError('');
    if (kind === 'export') { exportTicket.current++; if (exportRef.current) URL.revokeObjectURL(exportRef.current.url); exportRef.current = null; setExportUrl(null); }
  }
  async function locked(task: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); try { await task(); } finally { lock.current = false; setBusy(false); } }

  async function rename() {
    if (!repo || !active) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 30) { setError('名称须为 1–30 个字符。'); return; }
    await locked(async () => {
      const result = await repo.renameAnyWork({ workId: active.id, expectedWorkRevision: active.work?.work.revision ?? null, expectedDraftRevision: active.draft?.revision ?? null, name: trimmed });
      if (!result.ok) { setError(`${result.error.message}（${result.error.code}）。请重新载入后检查。`); return; }
      setDialog(null); setNotice('作品已改名'); await refresh(repo);
    });
  }

  async function remove() {
    if (!repo || !active) return;
    await locked(async () => {
      const result = await repo.deleteAnyWork({ workId: active.id, expectedWorkRevision: active.work?.work.revision ?? null, expectedDraftRevision: active.draft?.revision ?? null });
      if (!result.ok) { setError(`${result.error.message}（${result.error.code}）。作品仍保留，请重新载入。`); return; }
      setDialog(null); setNotice('作品已删除'); await refresh(repo);
    });
  }

  async function copy(entry: WorkEntry, source: EntryVersion) {
    if (!repo) return;
    await locked(async () => {
      let attempt = copyAttempt.current;
      if (!attempt || attempt.sourceId !== entry.id || attempt.version !== source) {
        const selection = selectVersion(entry, source);
        const now = new Date().toISOString();
        const target = { ...structuredClone(selection.work), id: generateUuid(), name: copyName(selection.work.name), revision: 0, createdAt: now, updatedAt: now };
        attempt = { sourceId: entry.id, version: source, schemaVersion: selection.schemaVersion, target };
        copyAttempt.current = attempt;
      }
      const target = attempt.target;
      const existing = source === 'draft' ? await repo.readAnyDraft(target.id) : await repo.readAnyWork(target.id);
      if (existing.ok) { copyAttempt.current = null; setNotice('副本已创建'); await refresh(repo); return; }
      if (existing.error.code !== 'NOT_FOUND') { setError(`无法核验副本结果：${existing.error.message}`); return; }
      const result = attempt.schemaVersion === 1
        ? await copyV1(repo, target as Work, entry, source)
        : await copyV2(repo, target as WorkV2, entry, source);
      if (!result.ok) {
        const verify = source === 'draft' ? await repo.readAnyDraft(target.id) : await repo.readAnyWork(target.id);
        if (verify.ok) { copyAttempt.current = null; setNotice('副本已创建'); await refresh(repo); return; }
        setError(`复制未完成：${result.error.message}。重试将使用同一个副本 ID。`); return;
      }
      copyAttempt.current = null; setNotice('副本已创建'); await refresh(repo);
    });
  }

  async function copyV1(repository: IndexedDbRepository, target: Work, entry: WorkEntry, source: EntryVersion) {
    return source === 'draft'
      ? repository.saveDraft({ work: target, step: entry.draft?.step ?? 'cut', expectedDraftRevision: null, baseRevision: null })
      : repository.save({ work: target, expectedRevision: null });
  }
  async function copyV2(repository: IndexedDbRepository, target: WorkV2, entry: WorkEntry, source: EntryVersion) {
    if (source !== 'completed') return repository.saveV2Draft({ work: target, step: entry.draft?.step ?? 'cut', expectedDraftRevision: null, baseRevision: null });
    const stored = await repository.readAnyThumbnail(entry.id);
    const thumbnail = stored.ok && stored.value.state === 'ready' && stored.value.blob ? stored.value.blob : undefined;
    return repository.saveV2WithThumbnail({ work: target, expectedRevision: null }, thumbnail);
  }

  async function generateExport() {
    if (!active) return;
    const selection = selectVersion(active, version), ticket = ++exportTicket.current;
    await locked(async () => {
      try {
        const result = selection.schemaVersion === 1
          ? await exporterV1.exportCard({ work: selection.work })
          : await exporterV2.exportCard({ work: selection.work });
        if (ticket !== exportTicket.current) return;
        if (!result.ok) { setError(result.error.message); return; }
        const blob = new Blob([result.value.bytes.slice().buffer], { type: result.value.mimeType });
        const next = { url: URL.createObjectURL(blob), filename: result.value.filename };
        if (exportRef.current) URL.revokeObjectURL(exportRef.current.url);
        exportRef.current = next; setExportUrl(next); setNotice('作品卡已生成');
      } catch { if (ticket === exportTicket.current) setError('作品卡生成失败，请重试。'); }
    });
  }

  async function downloadBackup() {
    if (!repo) return;
    await locked(async () => {
      try {
        const blob = await backupJson(repo), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `手上中国_本地原始备份_${new Date().toISOString().slice(0, 10)}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setNotice('原始备份下载已触发，请检查浏览器下载记录。');
      } catch (e) { setError(e instanceof Error ? e.message : '备份失败'); }
    });
  }

  return <main className="mw-page ss-theme"><header><p>手上中国 · 本地作品</p><h1>我的作品</h1><div className="mw-actions"><Button disabled={entries.length >= 100} onClick={onCreate}>开始剪纸</Button><Button intent="secondary" onClick={onExit}>返回首页</Button></div></header>
    {entries.length >= 100 && <InlineNotice tone="warning">已达到 100 件作品上限；已有作品仍可查看、更新、导出和删除。</InlineNotice>}
    <InlineNotice tone="warning">个人作品仅保存在此浏览器。清除网站数据、隐私模式及系统清理可能导致丢失；不提供云备份。建议及时导出作品卡。</InlineNotice>
    <div className="mw-toolbar"><div role="group" aria-label="作品状态筛选">{([['all', '全部'], ['draft', '草稿'], ['completed', '已完成']] as const).map(([key, label]) => <Button key={key} intent={filter === key ? 'primary' : 'secondary'} onClick={() => chooseFilter(key)}>{label}</Button>)}</div><Button intent="secondary" onClick={() => { if (repo) void refresh(repo); else location.reload(); }}>刷新列表</Button></div>
    {notice && <p role="status">{notice}</p>}{error && <InlineNotice tone="error">{error}<Button intent="secondary" onClick={() => { setError(''); if (repo) void refresh(repo); else location.reload(); }}>重新载入</Button></InlineNotice>}
    {issues.length > 0 && <InlineNotice tone="warning">发现 {issues.length} 条损坏或不兼容记录；原始数据已保留。<Button onClick={() => { void downloadBackup(); }}>下载原始备份</Button></InlineNotice>}
    {phase === 'loading' ? <p role="status">正在读取本地作品…</p> : phase === 'error' ? <p role="alert">本地作品读取失败。请重试或重新连接存储。</p> : visible.length === 0 ? <section className="mw-empty"><h2>{entries.length === 0 ? '还没有作品' : '此筛选没有作品'}</h2><p>{entries.length === 0 ? '从剪纸工坊开始创作。' : '切换筛选查看其他作品。'}</p></section> : <><p>共 {visible.length} 件作品；同 ID 的主记录与编辑草稿计为一件。</p><div className="mw-grid">{pageItems.map(entry => {
      const shown = shownVersion(entry), display = selectVersion(entry, shown), versions = entryVersions(entry), readOnly = isReadExportOnly(entry);
      return <article className="mw-card" key={entry.id}><Thumbnail repo={repo!} entry={entry} version={shown}/><div><h2>{display.work.name}</h2><p>工艺：{display.work.craftId === 'craft-papercut' ? '剪纸' : display.work.craftId}</p><p>状态：{statusText(entry)}</p><p>版本：{versionText(entry)}</p>{readOnly && <p><strong>只读历史作品</strong></p>}<p>卡片展示：{sourceLabel(shown)}</p><p>最近更新：{dateText(entry.updatedAt)}</p></div><div className="mw-card-actions">
        {readOnly
          ? <Button onClick={() => onOpen(entry.id, entry.draft ? 'draft' : entry.work?.work.status === 'draft' ? 'stored-draft' : 'completed')}>查看作品</Button>
          : <>{entry.draft && <Button onClick={() => onOpen(entry.id, 'draft')}>继续草稿</Button>}{entry.work?.work.status === 'draft' && !entry.draft && <Button intent="secondary" onClick={() => onOpen(entry.id, 'stored-draft')}>继续主记录草稿</Button>}{entry.work?.work.status === 'completed' && <Button intent="secondary" onClick={() => onOpen(entry.id, 'completed')}>编辑完成版</Button>}</>}
        {versions.map(v => { const selection = selectVersion(entry, v), copyAllowed = canCopySelection(selection, EDITOR_PROFILE_REGISTRY_V2); return <div key={v} className="mw-version-actions"><span>{sourceLabel(v)} · {selection.schemaVersion === 1 ? 'v1' : 'v2'}</span>{copyAllowed && <Button intent="secondary" disabled={busy} onClick={() => { void copy(entry, v); }}>复制</Button>}<Button intent="secondary" disabled={busy} onClick={() => openDialog('export', entry, v)}>导出 PNG</Button></div>; })}
        {canRename(entry) && <Button intent="secondary" disabled={busy} onClick={() => openDialog('rename', entry, shown)}>改名</Button>}
        <Button intent="danger" disabled={busy} onClick={() => openDialog('delete', entry, shown)}>删除</Button>
      </div></article>;
    })}</div><nav className="mw-pagination" aria-label="作品分页"><Button intent="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button><span>第 {page} / {pageCount} 页</span><Button intent="secondary" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一页</Button></nav></>}
    <Dialog open={dialog === 'rename'} title="改名整件作品" onClose={() => { if (!busy) setDialog(null); }} actions={<><Button intent="secondary" disabled={busy} onClick={() => setDialog(null)}>取消</Button><Button disabled={busy} onClick={() => { void rename(); }}>保存名称</Button></>}>完成版与编辑草稿将统一改名，内容各自保留。<label className="mw-name">作品名称<input value={name} maxLength={30} onChange={e => setName(e.target.value)}/></label>{error && <p role="alert">{error}</p>}</Dialog>
    <Dialog open={dialog === 'delete'} title="确认删除作品" onClose={() => { if (!busy) setDialog(null); }} actions={<><Button intent="secondary" disabled={busy} onClick={() => setDialog(null)}>取消</Button><Button intent="danger" disabled={busy} onClick={() => { void remove(); }}>确认永久删除</Button></>}>确定删除“{active?.draft?.work.name ?? active?.work?.work.name}”吗？将同时删除{active?.work ? '完成版、' : ''}{active?.draft ? '关联编辑草稿、' : ''}缩略图。删除不可恢复。{error && <p role="alert">{error}</p>}</Dialog>
    <Dialog open={dialog === 'export'} title={`导出${sourceLabel(version)} PNG 作品卡`} onClose={() => { exportTicket.current++; if (!busy) setDialog(null); }} actions={<><Button intent="secondary" onClick={() => { exportTicket.current++; setDialog(null); }}>关闭</Button><Button disabled={busy} onClick={() => { void generateExport(); }}>生成 PNG 作品卡</Button></>}>{exportUrl ? <><p>作品卡已生成。下载触发不代表已保存到设备。</p><img className="mw-export-preview" src={exportUrl.url} alt="作品卡预览"/><p><a href={exportUrl.url} download={exportUrl.filename}>下载 PNG</a> · <a href={exportUrl.url} target="_blank" rel="noopener noreferrer">打开图片</a></p><p>手机可打开图片后尝试长按保存。</p></> : <p>将从{sourceLabel(version)}的独立快照生成作品卡。</p>}{error && <p role="alert">{error}</p>}</Dialog>
  </main>;
}
