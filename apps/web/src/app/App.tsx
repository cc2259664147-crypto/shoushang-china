import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Exhibit, Result, Page } from '@shoushang/contracts';
import { createMockContentClient } from '@shoushang/content-client';
import { WorkshopPage } from '../features/workshop';
import { contentClient } from './content';

export function App() {
  const [path, setPath] = useState(location.pathname);
  const workshopContent = useMemo(() => { const query = new URLSearchParams(location.search); const scenario = query.get('m07scenario'); return query.get('m07db')?.startsWith('m07-test-') && (scenario === 'empty' || scenario === 'failure') ? createMockContentClient(scenario) : contentClient; }, []);
  const currentPath = useRef(path); currentPath.current = path;
  const historyIndex = useRef(typeof history.state?.wsIndex === 'number' ? history.state.wsIndex as number : 0);
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const registerLeaveGuard = useCallback((value: (() => Promise<boolean>) | null) => { guard.current = value; }, []);
  const navigate = useCallback(async (target: string, skipGuard = false) => {
    const pathname = new URL(target, location.href).pathname;
    if (!skipGuard && currentPath.current === '/workshop/papercut' && pathname !== '/workshop/papercut' && guard.current && !(await guard.current())) return;
    const nextIndex = historyIndex.current + 1;
    history.pushState({ wsIndex: nextIndex }, '', target); historyIndex.current = nextIndex; currentPath.current = pathname; setPath(pathname);
  }, []);
  useEffect(() => {
    if (typeof history.state?.wsIndex !== 'number') history.replaceState({ ...history.state, wsIndex: historyIndex.current }, '');
    const pop = () => {
      const target = location.pathname;
      const sourceIndex = historyIndex.current;
      const targetIndex = typeof history.state?.wsIndex === 'number' ? history.state.wsIndex as number : sourceIndex - 1;
      if (currentPath.current !== '/workshop/papercut' || target === '/workshop/papercut' || !guard.current) { historyIndex.current = targetIndex; currentPath.current = target; setPath(target); return; }
      // Keep the browser's history entry intact while the workshop asks the user.
      void guard.current().then(allowed => {
        if (allowed) { historyIndex.current = targetIndex; currentPath.current = target; setPath(target); }
        else history.go(sourceIndex - targetIndex);
      });
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  const [result, setResult] = useState<Result<Page<Exhibit>> | null>(null);
  useEffect(() => { let active = true; void contentClient.listExhibits().then(value => { if (active) setResult(value); }); return () => { active = false; }; }, []);
  if (path === '/workshop/papercut') { const query = new URLSearchParams(location.search), name = query.get('m07db'), fault = query.get('m07fault'); return <WorkshopPage contentClient={workshopContent} onExit={() => { void navigate('/', true); }} registerLeaveGuard={registerLeaveGuard} {...(name?.startsWith('m07-test-') ? { databaseName: name, ...(fault === 'quota' || fault === 'thumbnail' ? { testFault: fault } : {}) } : {})} />; }
  return <main>
    <h1>手上中国 · 工程检查页</h1>
    <p>项目已启动。正式首页、展馆和故事页尚未开发。</p>
    <p>当前内容数据模式：<strong>{contentClient.mode}</strong>（开发样例）</p>
    <p><a href="/workshop/papercut" onClick={e => { e.preventDefault(); const testDb = new URLSearchParams(location.search).get('m07db'); void navigate(`/workshop/papercut${testDb?.startsWith('m07-test-') ? `?m07db=${encodeURIComponent(testDb)}` : ''}`); }}>进入剪纸工坊</a></p>
    <section aria-labelledby="content-title"><h2 id="content-title">通过内容访问层读取的示例展品</h2><div role="status" aria-live="polite">{result === null ? <p>读取中…</p> : !result.ok ? <p>内容加载失败：{result.error.message}</p> : result.value.items.length === 0 ? <p>暂无示例内容。</p> : result.value.items.map(item => <article key={item.id}><h3>{item.title}</h3><p>{item.summary}</p>{item.media.map(media => <img key={media.id} src={media.url} alt={media.alt} width="160" height="160" />)}<p>开发占位，未经正式文化内容审核，不作为文化事实发布。</p></article>)}</div></section>
    <h2>工程结构</h2><p>apps/web：前端；apps/api：健康检查；packages：模块公开入口；fixtures：确定性样例。</p><p>请查看代码根目录 README.md、docs/architecture、docs/contracts 和 docs/tasks/M01.md 至 M14.md。</p><p>剪纸工坊使用真实 IndexedDB 保存本地草稿和已完成作品；其他正式功能仍在后续模块开发。</p><p><a href="/health" target="_blank" rel="noreferrer">后端健康检查（Vite 代理）</a></p>
  </main>;
}
