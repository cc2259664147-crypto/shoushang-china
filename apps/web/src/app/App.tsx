import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Exhibit, Result, Page } from '@shoushang/contracts';
import { createMockContentClient } from '@shoushang/content-client';
import { NewWorkshopPage, VersionedWorkshopPage } from '../features/workshop';
import { MyWorksPage } from '../features/my-works';
import { contentClient } from './content';
import { GalleryPage } from '../features/gallery';
import { HomePage } from '../features/home';
import { StoriesPage } from '../features/stories';
import { SiteNav } from './SiteNav';
import { AdminPage } from '../features/admin';
import type { ReactNode } from 'react';
import { ContentLink } from '../features/stories/content';

export function App() {
  const [path, setPath] = useState(location.pathname);
  const [routeVersion, setRouteVersion] = useState(0);
  const workshopContent = useMemo(() => { const query = new URLSearchParams(location.search); const scenario = query.get('m07scenario'); return query.get('m07db')?.startsWith('m07-test-') && (scenario === 'empty' || scenario === 'failure') ? createMockContentClient(scenario) : contentClient; }, []);
  const currentPath = useRef(path); currentPath.current = path;
  const currentUrl = useRef(location.href);
  const historyIndex = useRef(typeof history.state?.wsIndex === 'number' ? history.state.wsIndex as number : 0);
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const registerLeaveGuard = useCallback((value: (() => Promise<boolean>) | null) => { guard.current = value; }, []);
  const navigate = useCallback(async (target: string, skipGuard = false) => {
    const pathname = new URL(target, location.href).pathname;
    if (!skipGuard && currentPath.current === '/workshop/papercut' && new URL(target,location.href).href !== currentUrl.current && guard.current && !(await guard.current())) return;
    const nextIndex = historyIndex.current + 1;
    history.pushState({ wsIndex: nextIndex }, '', target); historyIndex.current = nextIndex; currentPath.current = pathname;currentUrl.current=location.href; setPath(pathname);setRouteVersion(value=>value+1);
  }, []);
  useEffect(() => {
    if (typeof history.state?.wsIndex !== 'number') history.replaceState({ ...history.state, wsIndex: historyIndex.current }, '');
    const pop = () => {
      const target = location.pathname;
      const sourceIndex = historyIndex.current;
      const targetIndex = typeof history.state?.wsIndex === 'number' ? history.state.wsIndex as number : sourceIndex - 1;
      if (currentPath.current !== '/workshop/papercut' || location.href === currentUrl.current || !guard.current) { historyIndex.current = targetIndex; currentPath.current = target;currentUrl.current=location.href; setPath(target);setRouteVersion(value=>value+1); return; }
      // Keep the browser's history entry intact while the workshop asks the user.
      void guard.current().then(allowed => {
        if (allowed) { historyIndex.current = targetIndex; currentPath.current = target;currentUrl.current=location.href; setPath(target);setRouteVersion(value=>value+1); }
        else history.go(sourceIndex - targetIndex);
      });
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => { if (location.hash === '#about') { const frame = requestAnimationFrame(() => document.getElementById('about')?.scrollIntoView()); return () => cancelAnimationFrame(frame); } }, [path, routeVersion]);
  const [result, setResult] = useState<Result<Page<Exhibit>> | null>(null);
  useEffect(() => { if (path !== '/engineering') return; let active = true; setResult(null); void contentClient.listExhibits().then(value => { if (active) setResult(value); }); return () => { active = false; }; }, [path]);
  const query = new URLSearchParams(location.search), name = query.get('m07db'), fault = query.get('m07fault'), testDb = name?.startsWith('m07-test-') ? name : undefined;
  const suffix = testDb ? `?m07db=${encodeURIComponent(testDb)}` : '';
  const shell = (page: ReactNode) => <><SiteNav navigate={target => { void navigate(target); }} url={location.href} />{page}</>;
  if (path === '/admin' || path.startsWith('/admin/')) return <AdminPage />;
  if (path === '/') return shell(<HomePage client={contentClient} navigate={target => { void navigate(target); }} workshopHref={`/workshop/papercut${suffix}`} />);
  if (path === '/stories' || path.startsWith('/stories/')) return shell(<StoriesPage client={contentClient} url={location.pathname + location.search} navigate={target => { void navigate(target); }} />);
  if (path === '/gallery' || path.startsWith('/gallery/') || path === '/my/favorites') return shell(<GalleryPage client={contentClient} url={location.pathname + location.search} navigate={target => { void navigate(target); }} />);
  if (path === '/workshop/papercut') { const workId=query.get('workId'), templateId=query.get('templateId');if(workId)return <VersionedWorkshopPage key={`${workId}:${testDb??''}`} workId={workId} onExit={()=>{void navigate('/');}} onWorkChanged={newWorkId=>{const params=new URLSearchParams({...testDb?{m07db:testDb}:{},workId:newWorkId,version:'stored-draft'});void navigate(`/workshop/papercut?${params.toString()}`,true);}} registerLeaveGuard={registerLeaveGuard} {...(testDb?{databaseName:testDb,...(fault==='quota'||fault==='thumbnail'?{testFault:fault}:{})}:{})}/>;return <NewWorkshopPage key={`${testDb??''}:${templateId??''}`} contentClient={workshopContent} {...(templateId ? {initialTemplateId:templateId} : {})} onCreated={newWorkId=>{const params=new URLSearchParams({...testDb?{m07db:testDb}:{},workId:newWorkId,version:'stored-draft'});void navigate(`/workshop/papercut?${params.toString()}`,true);}} onExit={() => { void navigate('/', true); }} onWorks={() => { void navigate(`/my/works${suffix}`,true); }} {...(testDb ? { databaseName: testDb, ...(fault === 'quota' ? { testFault:fault } : {}) } : {})} />; }
  if (path === '/my/works') return shell(<MyWorksPage key={testDb??'default'} {...(testDb?{databaseName:testDb}:{})} onCreate={()=>{void navigate(`/workshop/papercut${suffix}`);}} onExit={()=>{void navigate('/');}} onOpen={(id,version)=>{void navigate(`/workshop/papercut?${new URLSearchParams({...testDb?{m07db:testDb}:{},workId:id,version}).toString()}`);}}/>);
  if (path !== '/engineering') return shell(<main className="m11-page st-page ss-theme"><h1>页面未找到</h1><p>该地址没有对应页面。</p><a href="/">返回首页</a></main>);
  return shell(<main>
    <h1>手上中国 · 工程检查页</h1>
    <p>项目已启动。首页、故事与展馆通过 HTTP 读取服务端当前公开内容，不代表正式上线。</p>
    <p><a href="/gallery" onClick={e=>{if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();void navigate('/gallery');}}}>数字展馆</a> · <a href="/my/favorites" onClick={e=>{if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();void navigate('/my/favorites');}}}>我的收藏</a></p>
    <p>当前内容数据模式：<strong>{contentClient.mode}</strong>（开发样例）</p>
    <p><ContentLink href={`/workshop/papercut${suffix}`} navigate={target => { void navigate(target); }}>进入剪纸工坊</ContentLink></p>
    <p><ContentLink href={`/my/works${suffix}`} navigate={target => { void navigate(target); }}>我的作品</ContentLink></p>
    <section aria-labelledby="content-title"><h2 id="content-title">通过内容访问层读取的示例展品</h2><div role="status" aria-live="polite">{result === null ? <p>读取中…</p> : !result.ok ? <p>内容加载失败：{result.error.message}</p> : result.value.items.length === 0 ? <p>暂无示例内容。</p> : result.value.items.map(item => <article key={item.id}><h3>{item.title}</h3><p>{item.summary}</p>{item.media.map(media => <img key={media.id} src={media.url} alt={media.alt} width="160" height="160" />)}<p>开发占位，未经正式文化内容审核，不作为文化事实发布。</p></article>)}</div></section>
    <h2>工程结构</h2><p>apps/web：前端；apps/api：SQLite 公开内容服务、存活与就绪检查；packages：模块公开入口；fixtures：隔离开发样例。</p><p>请查看代码根目录 README.md、docs/architecture、docs/contracts 和 docs/tasks/M01.md 至 M14.md。</p><p>剪纸工坊使用真实 IndexedDB 保存本地草稿和已完成作品；正式内容、媒体授权、管理权限与生产部署尚未验收。</p><p><a href="/health" target="_blank" rel="noopener noreferrer">后端健康检查（Vite 代理）</a></p>
  </main>);
}
