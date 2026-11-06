import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createArtworkRenderer, createArtworkRendererV2 } from '@shoushang/artwork-renderer';
import { openIndexedDbRepository } from '@shoushang/local-repository';
import { FreehandEditor } from './editor/FreehandEditor';
import { VersionedWorkshopStorage } from './versioned-storage';
import { VersionedWorkshopSession } from './versioned-workshop-session';
import './workshop.css';

export interface VersionedWorkshopPageProps {
  readonly workId: string;
  readonly onExit: () => void;
  readonly onWorkChanged: (workId: string) => void;
  readonly registerLeaveGuard?: (guard: (() => Promise<boolean>) | null) => void;
  readonly databaseName?: string;
  readonly testFault?: 'quota' | 'thumbnail';
}

const rendererV1 = createArtworkRenderer();
const rendererV2 = createArtworkRendererV2();

export function VersionedWorkshopPage({ workId, onExit, onWorkChanged, registerLeaveGuard, databaseName, testFault }: VersionedWorkshopPageProps) {
  const session = useMemo(() => {
    const storage = new VersionedWorkshopStorage({
      openIndexedDbRepository: options => openIndexedDbRepository({
        ...options,
        ...(databaseName ? { name: databaseName } : {}),
        ...(testFault === 'quota' ? { testQuotaAfterWrite: true } : {}),
      }),
    });
    return new VersionedWorkshopSession({
      storage,
      renderer: rendererV2,
      ...(testFault === 'thumbnail' ? { createThumbnail: async () => { throw new Error('测试注入的缩略图失败'); } } : {}),
    });
  }, [databaseName, testFault]);
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const lifecycle = useRef(0);
  const [readonlyView, setReadonlyView] = useState<'folded' | 'unfolded'>('unfolded');

  useEffect(() => {
    const token = ++lifecycle.current;
    void session.start(workId);
    return () => {
      queueMicrotask(() => { if (lifecycle.current === token) void session.dispose(); });
    };
  }, [session, workId]);

  useEffect(() => {
    const guard = async () => !session.hasUncommitted() || window.confirm('当前作品还有未保存修改，确定离开吗？');
    registerLeaveGuard?.(guard);
    return () => registerLeaveGuard?.(null);
  }, [registerLeaveGuard, session]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.hasUncommitted()) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [session]);

  const preview = useMemo(() => {
    const record = snapshot.record;
    if (!record || record.kind === 'editable-v2') return null;
    return record.kind === 'readonly-v1'
      ? rendererV1.render({ work: record.work, width: 640, height: 640, view: 'unfolded' })
      : rendererV2.render({ work: record.work, width: 640, height: 640, view: readonlyView });
  }, [readonlyView, snapshot.record]);

  async function saveCopy(): Promise<void> {
    const newId = await session.saveV1AsEditableCopy();
    if (newId) onWorkChanged(newId);
  }

  const openFailureMessage = snapshot.error
    ? `${snapshot.error.message}（${snapshot.error.code === 'UNSUPPORTED_VERSION' ? '版本不兼容' : '记录损坏或不兼容'}）`
    : snapshot.message;

  return <main className="ws-page ws-versioned-page">
    <header className="ws-header">
      <div><p className="ws-eyebrow">版本感知工坊</p><h1>剪纸工坊</h1></div>
      <div className="ws-versioned-actions"><button type="button" onClick={onExit}>返回首页</button></div>
    </header>
    {snapshot.loading ? <section className="ws-versioned-state" role="status"><h2>正在打开作品…</h2><p>正在校验本地作品和草稿。</p></section> : null}
    {!snapshot.loading && !snapshot.record ? <section className="ws-versioned-state" role="alert"><h2>作品无法打开</h2><p>{openFailureMessage || '本地记录不存在、损坏或版本不兼容。'}</p><button type="button" onClick={() => { void session.reload(); }}>重新载入</button></section> : null}
    {snapshot.record?.kind === 'readonly-v1' ? <section className="ws-versioned-layout">
      <div className="ws-panel"><h2>旧版作品为只读</h2><p>{snapshot.record.source === 'draft' ? '已恢复同 ID 的较新旧版草稿。' : '旧版完成作品不会被原位修改。'}</p><button type="button" disabled={snapshot.status === 'saving'} onClick={() => { void saveCopy(); }}>另存为可编辑副本</button></div>
      <ReadonlyPreview preview={preview} />
    </section> : null}
    {snapshot.record?.kind === 'readonly-v2' ? <section className="ws-versioned-layout">
      <div className="ws-panel"><h2>此作品仅供查看和导出</h2><p>该历史编辑器配置为 read-export-only，不能继续创作或丢弃草稿。</p><div className="ws-view-switch" role="group" aria-label="只读预览方式"><button type="button" aria-pressed={readonlyView === 'folded'} onClick={() => setReadonlyView('folded')}>折叠视图</button><button type="button" aria-pressed={readonlyView === 'unfolded'} onClick={() => setReadonlyView('unfolded')}>展开视图</button></div></div>
      <ReadonlyPreview preview={preview} />
    </section> : null}
    {snapshot.record?.kind === 'editable-v2' && snapshot.currentWork && snapshot.controller ? <>
      <section className="ws-versioned-savebar" aria-label="作品保存状态">
        <p role={snapshot.status === 'error' || snapshot.status === 'conflict' ? 'alert' : 'status'}>{snapshot.message || (snapshot.status === 'saved' ? '草稿已保存' : snapshot.status === 'editing' ? '有未保存修改' : '可编辑 v2 作品')}</p>
        <div>
          <button type="button" disabled={snapshot.status === 'saving' || snapshot.status === 'committing'} onClick={() => { void session.saveNow(); }}>保存草稿</button>
          <button type="button" disabled={snapshot.status === 'saving' || snapshot.status === 'committing'} onClick={() => { void session.commit(); }}>完成并保存作品</button>
        </div>
        {snapshot.status === 'conflict' ? <div className="ws-versioned-conflict"><button type="button" onClick={() => { void session.reload(); }}>重新载入</button><button type="button" onClick={() => { void session.retrySave(); }}>重试保存</button><p>画布中的本地内容仍保留；重新载入会改用数据库中的最新版本。</p></div> : null}
      </section>
      <FreehandEditor key={snapshot.controller === null ? 'none' : snapshot.currentWork.id} work={snapshot.currentWork} controller={snapshot.controller} renderer={rendererV2} onConfirmedWork={work => session.confirmed(work)} />
    </> : null}
    {snapshot.record && snapshot.message && snapshot.record.kind !== 'editable-v2' ? <p className="ws-versioned-message" role={snapshot.status === 'error' || snapshot.status === 'conflict' ? 'alert' : 'status'}>{snapshot.message}</p> : null}
  </main>;
}

function ReadonlyPreview({ preview }: { readonly preview: ReturnType<typeof rendererV1.render> | ReturnType<typeof rendererV2.render> | null }) {
  return <section className="ws-center"><h2>作品预览</h2>{preview?.ok
    ? <div className="ws-versioned-preview" aria-label="只读作品预览" dangerouslySetInnerHTML={{ __html: preview.value.svg }} />
    : <p role="alert">预览失败：{preview && !preview.ok ? preview.error.message : '作品不可用'}</p>}</section>;
}
