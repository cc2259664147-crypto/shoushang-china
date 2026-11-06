import { useCallback, useEffect, useMemo } from 'react';
import { IdSchema } from '@shoushang/contracts';
import type { ContentClient, Result, Story } from '@shoushang/contracts';
import { Button, EmptyState, FormField, InlineNotice, LoadingState, Select } from '@shoushang/ui';
import { ContentLink, ContentPicture, ContentFailure, DevelopmentNotice, Sources, failure, useContent } from './content';
import type { Navigate } from './content';
import { parseStoryQuery, storiesUrl, storyReturn } from './query';
import { rememberStory, useStoryPosition } from './position';
import '../home/home.css';
import './stories.css';

export interface StoriesPageProps { client: ContentClient; url: string; navigate: Navigate }
const localImages: Record<string, { url: string; alt: string; credit: string }> = {
  '周淑英': { url: '/story-portraits/zhou.png', alt: '周淑英展示生肖蛇剪纸作品', credit: '新华社记者王晓摄' },
  '张秀芳': { url: '/story-portraits/zhang.jpg', alt: '张秀芳剪纸作品《桃花柳燕》', credit: '张秀芳《桃花柳燕》，来源：中国剪纸博物馆' },
  '陈秋日': { url: '/story-portraits/chen.jpg', alt: '陈秋日剪纸作品《秋实》', credit: '陈秋日《秋实》，林杜鸿摄' },
};
function localImage(story: Story) {
  return localImages[story.personName];
}
function StoryPicture({ story, eager = false }: { story: Story; eager?: boolean }) {
  const preview = localImage(story);
  return preview ? <div className="m11-picture"><img src={preview.url} alt={preview.alt} loading={eager ? 'eager' : 'lazy'} /></div> : <ContentPicture media={story.cover} eager={eager} />;
}
function List({ client, url, navigate }: StoriesPageProps) {
  const search = new URL(url, location.origin).search;
  const parsed = useMemo(() => parseStoryQuery(search), [search]);
  const load = useCallback(() => parsed.ok ? client.listStories(parsed.value) : Promise.resolve(failure<never>()), [client, parsed]);
  const loadCrafts = useCallback(() => client.listCrafts(), [client]);
  const { result, refresh } = useContent(search, load);
  const crafts = useContent('crafts', loadCrafts, false);
  const ready = !!result?.ok && parsed.ok;
  useStoryPosition(url, ready);
  const items = result?.ok ? result.value.items : [];
  const last = result?.ok ? Math.max(1, Math.ceil(result.value.total / 12)) : 1;
  return <><header className="st-heading"><p className="hm-kicker">技艺背后，是人的时光</p><h1>匠人故事</h1><p>从经历与作品，走近一门技艺。每一段叙述，都应有可追溯的来源。</p></header><DevelopmentNotice client={client} />
    {!parsed.ok ? <InlineNotice tone="error">查询参数错误：{parsed.error}；原 URL 已保留。<ContentLink href="/stories" navigate={navigate}>清空筛选</ContentLink></InlineNotice> : <>
      <div className="st-filters">{!crafts.result ? <LoadingState label="读取工艺筛选" /> : !crafts.result.ok ? <ContentFailure message={`工艺读取失败：${crafts.result.error.code}`} retry={crafts.refresh} /> : <FormField label="工艺">{field => <Select {...field} value={parsed.value.craftId ?? ''} options={[{ value: '', label: '全部工艺' }, ...crafts.result && crafts.result.ok ? crafts.result.value.map(c => ({ value: c.id, label: c.name })) : [], ...(parsed.value.craftId && crafts.result?.ok && !crafts.result.value.some(c => c.id === parsed.value.craftId) ? [{ value: parsed.value.craftId, label: `未匹配：${parsed.value.craftId}` }] : [])]} onChange={e => navigate(storiesUrl(e.target.value ? { craftId: e.target.value, page: 1 } : { page: 1 }))} />}</FormField>}<ContentLink href="/stories" navigate={navigate}>清空筛选</ContentLink></div>
      {crafts.result?.ok && parsed.value.craftId && !crafts.result.value.some(c => c.id === parsed.value.craftId) && <InlineNotice tone="warning">工艺 ID 未匹配公开目录：{parsed.value.craftId}</InlineNotice>}
      <p>当前工艺：{parsed.value.craftId ? crafts.result?.ok ? crafts.result.value.find(c => c.id === parsed.value.craftId)?.name ?? parsed.value.craftId : parsed.value.craftId : '全部工艺'}</p>
      <div className="st-list-slot">{!result ? <><LoadingState label="读取故事列表" /><div className="st-grid" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <div className="st-card-skeleton" key={i}><div className="m11-picture m11-placeholder" style={{ aspectRatio: '4 / 3' }} /><div>{Array.from({ length: 5 }, (_, n) => <div key={n} className="m11-placeholder m11-placeholder-line" />)}</div></div>)}</div></> : !result.ok ? <ContentFailure message={`故事列表加载失败（${result.error.code}）：${result.error.message}`} retry={refresh} /> : parsed.value.page > last ? <EmptyState title="页码超出范围" description={`所请求的第 ${parsed.value.page} 页不存在，共 ${result.value.total} 篇。`} action={<ContentLink href={storiesUrl({ ...parsed.value, page: last })} navigate={navigate}>前往有效末页</ContentLink>} /> : !items.length ? <EmptyState title="没有匹配故事" description="当前条件下没有故事；不会用其他人物替代。" action={<ContentLink href="/stories" navigate={navigate}>清空筛选</ContentLink>} /> : <div className="st-grid">{items.map(story => <article className="st-card" key={story.id}><StoryPicture key={story.cover.url} story={story} />{localImage(story) ? <p className="st-cover-note">{localImage(story)?.credit}</p> : story.cover.alt === '项目数字示意，非人物照片或作品' && <p className="st-cover-note">{story.cover.alt}</p>}<div><p className="hm-kicker">{story.craftIds.map(id => crafts.result?.ok ? crafts.result.value.find(c => c.id === id)?.name ?? id : id).join('、')} · {story.region}</p><h2><ContentLink id={`story-${story.id}`} href={`/stories/${encodeURIComponent(story.id)}?${new URLSearchParams({ returnTo: url })}`} navigate={navigate} onLeave={() => rememberStory(url, story.id)}>{story.title}</ContentLink></h2><p>{story.personName}</p><p>{story.summary}</p>{(client.mode === 'mock' || story.developmentOnly) && <p className="m11-dev">开发示例 · 未配置真实匠人</p>}</div></article>)}</div>}</div>
      {result?.ok && <nav className="st-pagination" aria-label="故事分页">{parsed.value.page > 1 ? <ContentLink href={storiesUrl({ ...parsed.value, page: parsed.value.page - 1 })} navigate={navigate}>上一页</ContentLink> : <span>上一页（不可用）</span>}<span>第 {parsed.value.page} / {last} 页 · 共 {result.value.total} 篇</span>{parsed.value.page < last ? <ContentLink href={storiesUrl({ ...parsed.value, page: parsed.value.page + 1 })} navigate={navigate}>下一页</ContentLink> : <span>下一页（不可用）</span>}</nav>}
    </> }</>;
}
function Detail({ client, url, navigate, id }: StoriesPageProps & { id: string }) {
  const valid = IdSchema.safeParse(id).success;
  const load = useCallback(async (): Promise<Result<Story>> => {
    if (!valid) return { ok: false, error: { code: 'INVALID_INPUT', message: '故事 ID 无效', requestId: 'm11-id', fieldErrors: [] } };
    const r = await client.getStory(id);
    return r.ok && r.value.id !== id ? failure('故事 ID 与请求不一致') : r;
  }, [client, id, valid]);
  const { result, refresh } = useContent(id, load);
  const loadCrafts = useCallback(() => client.listCrafts(), [client]);
  const crafts = useContent('crafts', loadCrafts, false);
  const back = storyReturn(new URL(url, location.origin).searchParams.get('returnTo'));
  useEffect(() => { scrollTo(0, 0); }, [id]);
  return <><ContentLink href={back} navigate={navigate}>返回故事列表</ContentLink>{!result ? <div className="st-detail-slot"><LoadingState label="读取故事详情" /></div> : !result.ok ? <><h1>{result.error.code === 'INVALID_INPUT' ? '故事 ID 无效' : result.error.code === 'NOT_FOUND' || result.error.code === 'FORBIDDEN' ? '故事不可用' : '故事加载失败'}</h1>{result.error.code === 'NOT_FOUND' || result.error.code === 'FORBIDDEN' ? <p>内容不存在或不可公开访问。旧正文、封面与关联项已清除。</p> : <ContentFailure message={`${result.error.code}：${result.error.message}`} retry={refresh} />}</> : <>
    <header className="st-heading"><p className="hm-kicker">{result.value.craftIds.map(c => crafts.result?.ok ? crafts.result.value.find(item => item.id === c)?.name ?? c : c).join('、')} · {result.value.region}</p><h1>{result.value.title}</h1><p className="st-summary">{result.value.summary}</p></header><DevelopmentNotice client={client} developmentOnly={result.value.developmentOnly} /><Button intent="secondary" onClick={refresh}>重新核验故事</Button>
    <div className="st-detail-intro"><figure><StoryPicture key={`${result.value.cover.id}:${result.value.cover.url}`} story={result.value} eager /><figcaption>{localImage(result.value) ? `${localImage(result.value)?.credit}` : result.value.cover.alt}</figcaption></figure><section><p className="hm-kicker">人物简介</p><h2>{result.value.personName}</h2><p>{result.value.personBio}</p><dl><dt>工艺</dt><dd>{result.value.craftIds.map(c => crafts.result?.ok ? crafts.result.value.find(item => item.id === c)?.name ?? c : c).join('、')}</dd><dt>地区</dt><dd>{result.value.region}</dd></dl></section></div>
    <section className="st-prose st-story"><div className="st-story-heading"><p className="hm-kicker">一纸之间 · 匠心传承</p><h2>走近{result.value.personName}</h2></div><div className="st-story-body">{result.value.body.map((block, i) => block.type === 'paragraph' ? <p key={i}>{block.text}</p> : null)}</div></section>
    <section className="st-experience"><h2>{result.value.timeline.length >= 3 ? '经历时间线' : '经历记录'}</h2>{!result.value.timeline.length ? <p>尚未配置有来源的经历记录。</p> : <ol className={result.value.timeline.length >= 3 ? 'st-timeline' : 'st-records'}>{result.value.timeline.map((node, i) => <li key={i}><h3>{node.dateLabel}</h3><p>{node.text}</p><details><summary>查看节点来源（{node.sources.length}）</summary><Sources sources={node.sources} /></details></li>)}</ol>}</section>
    <section className="st-prose"><h2>事实来源</h2><Sources sources={result.value.sources} /></section>
    <section className="st-prose"><h2>图像来源与媒体许可</h2>{localImage(result.value) && <p>当前展示图片：{localImage(result.value)?.credit}。以下信息对应原示意封面。</p>}<p>图像作者：{result.value.cover.author}</p>{result.value.cover.source && <p>图像来源：{result.value.cover.source}</p>}<p>许可：{result.value.cover.license.name}</p><p>署名：{result.value.cover.license.attribution}</p>{result.value.cover.license.url && <a href={result.value.cover.license.url} target="_blank" rel="noopener noreferrer">媒体许可（新标签页）</a>}{result.value.cover.modification && <p>修改说明：{result.value.cover.modification}</p>}</section>
  </>}</>;
}
export function StoriesPage(props: StoriesPageProps) {
  const path = new URL(props.url, location.origin).pathname;
  let id = '';
  try { id = decodeURIComponent(path.slice('/stories/'.length)); } catch { id = '!invalid'; }
  return <main className="st-page m11-page ss-theme">{path === '/stories' ? <List {...props} /> : <Detail key={id} {...props} id={id} />}</main>;
}
