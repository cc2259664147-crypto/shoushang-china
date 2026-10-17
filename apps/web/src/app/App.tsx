import { useEffect, useState } from 'react';
import type { Exhibit, Result, Page } from '@shoushang/contracts';
import { contentClient } from './content';

export function App() {
  const [result, setResult] = useState<Result<Page<Exhibit>> | null>(null);
  useEffect(() => {
    let active = true;
    void contentClient.listExhibits().then(value => { if (active) setResult(value); });
    return () => { active = false; };
  }, []);
  return <main>
    <h1>手上中国 · M01 项目检查页</h1>
    <p>项目已启动。这是工程检查页，正式首页尚未开发。</p>
    <p>当前内容数据模式：<strong>{contentClient.mode}</strong>（开发占位）</p>
    <section aria-labelledby="content-title">
      <h2 id="content-title">通过内容访问层读取的示例展品</h2>
      <div role="status" aria-live="polite">
        {result === null ? <p>读取中…</p> : !result.ok ? <p>内容加载失败：{result.error.message}</p> : result.value.items.length === 0 ? <p>暂无示例内容。</p> : result.value.items.map(item => <article key={item.id}>
          <h3>{item.title}</h3><p>{item.summary}</p>
          {item.media.map(media => <img key={media.id} src={media.url} alt={media.alt} width="160" height="160" />)}
          <p>开发占位，未经正式文化内容审核，不作为文化事实发布。</p>
        </article>)}
      </div>
    </section>
    <h2>工程结构</h2>
    <p>apps/web：前端；apps/api：健康检查；packages：模块公开入口；fixtures：确定性样例。</p>
    <p>请查看代码根目录 README.md、docs/architecture、docs/contracts 和 docs/tasks/M01.md 至 M14.md。</p>
    <p>个人作品持久化尚未实现。内存仓储仅供测试，刷新后丢失。</p>
    <p><a href="/health" target="_blank" rel="noreferrer">后端健康检查（Vite 代理）</a></p>
  </main>;
}
