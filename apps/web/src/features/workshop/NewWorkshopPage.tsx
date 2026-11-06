import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContentClient, PublicTemplate } from '@shoushang/contracts';
import { openIndexedDbRepository } from '@shoushang/local-repository';
import { Button, EmptyState, InlineNotice, LoadingState } from '@shoushang/ui';
import { VersionedWorkshopStorage } from './versioned-storage';
import { hasCreatableEditorProfile } from './editor/profiles';
import './workshop.css';

export interface NewWorkshopPageProps {
  readonly contentClient: ContentClient;
  readonly onCreated: (workId: string) => void;
  readonly onExit: () => void;
  readonly onWorks?: () => void;
  readonly initialTemplateId?: string;
  readonly databaseName?: string;
  readonly testFault?: 'quota';
}

export function NewWorkshopPage({
  contentClient, onCreated, onExit, onWorks, initialTemplateId, databaseName, testFault,
}: NewWorkshopPageProps) {
  const storage = useMemo(() => new VersionedWorkshopStorage({
    openIndexedDbRepository: options => openIndexedDbRepository({
      ...options,
      ...(databaseName ? { name: databaseName } : {}),
      ...(testFault === 'quota' ? { testQuotaAfterWrite: true } : {}),
    }),
  }), [databaseName, testFault]);
  const [templates, setTemplates] = useState<readonly PublicTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createError, setCreateError] = useState('');
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const autoAttempted = useRef<string | null>(null);
  const mounted = useRef(true);
  const lifecycle = useRef(0);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const result = await contentClient.listTemplates({ craftId: 'craft-papercut', pageSize: 50 });
    if (!mounted.current) return;
    setLoading(false);
    if (!result.ok) {
      setTemplates([]);
      setLoadError(result.error.message);
      return;
    }
    setTemplates(result.value.items.filter(template => template.enabled && template.craftId === 'craft-papercut' && hasCreatableEditorProfile(template)));
  }, [contentClient]);

  const create = useCallback(async (template: PublicTemplate) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCreatingTemplateId(template.id);
    setCreateError('');
    const result = await storage.createWorkFromTemplate(template);
    if (!mounted.current) return;
    if (!result.ok) {
      inFlight.current = false;
      setCreatingTemplateId(null);
      setCreateError(result.error.message);
      return;
    }
    onCreated(result.value.work.id);
  }, [onCreated, storage]);

  useEffect(() => {
    const token = ++lifecycle.current;
    mounted.current = true;
    void loadTemplates();
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (lifecycle.current === token) storage.dispose();
      });
    };
  }, [loadTemplates, storage]);

  useEffect(() => {
    if (loading || !initialTemplateId || autoAttempted.current === initialTemplateId) return;
    autoAttempted.current = initialTemplateId;
    const template = templates.find(item => item.id === initialTemplateId);
    if (!template) {
      setCreateError('链接中的模板不存在或当前不可用，请选择其他模板。');
      return;
    }
    void create(template);
  }, [create, initialTemplateId, loading, templates]);

  return <main className="ws-page ss-theme">
    <header className="ws-header">
      <div><p className="ws-eyebrow">手上中国 · 数字工坊</p><h1>剪纸工坊</h1><p>选择模板后将创建新版草稿，并直接进入自由剪刀编辑器。</p></div>
      <div><Button intent="secondary" onClick={onExit}>返回首页</Button>{onWorks ? <Button intent="secondary" onClick={onWorks}>我的作品</Button> : null}</div>
    </header>
    {createError ? <InlineNotice tone="error">创建失败：{createError.replace(/[。；;]+$/u, '')}。当前页面和模板选择已保留，可重试。</InlineNotice> : null}
    <section className="ws-versioned-state" aria-labelledby="new-work-title">
      <h2 id="new-work-title">选择创作模板</h2>
      {loading ? <LoadingState label="模板加载中" /> : loadError ? <InlineNotice tone="error">模板加载失败：{loadError}<Button onClick={() => { void loadTemplates(); }}>重试</Button></InlineNotice> : templates.length === 0 ? <EmptyState title="暂无模板" description="当前没有可用于新建作品的剪纸模板。" /> : <div className="ws-template-list">{templates.map(template => <article className="ws-template" key={`${template.id}:${template.version}`}>
        <strong>{template.name}</strong><p>{template.digitalNotice}</p>
        <Button loading={creatingTemplateId === template.id} disabled={inFlight.current} onClick={() => { void create(template); }}>使用模板</Button>
      </article>)}</div>}
    </section>
  </main>;
}
