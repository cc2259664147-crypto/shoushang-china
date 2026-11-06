import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { ContentClient, Media, Result, Story } from '@shoushang/contracts';
import { Button, InlineNotice } from '@shoushang/ui';

export type Navigate = (target: string) => void;
export function ContentLink({ href, navigate, children, id, onLeave, className, current = false }: { href: string; navigate: Navigate; children: ReactNode; id?: string; onLeave?: () => void; className?: string; current?: boolean }) {
  function click(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
    e.preventDefault(); onLeave?.(); navigate(href);
  }
  return <a href={href} onClick={click} {...(current ? { 'aria-current': 'page' as const } : {})} {...(id ? { id } : {})} {...(className ? { className } : {})}>{children}</a>;
}
export function failure<T>(message = '内容请求失败'): Result<T> { return { ok: false, error: { code: 'NETWORK_ERROR', message, requestId: 'm11-content', fieldErrors: [] } }; }
/** No DTO cache. Key changes, explicit rechecks and window focus withdraw old media first. */
export function useContent<T>(key: string, load: () => Promise<Result<T>>, recheckOnFocus = true) {
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<{ key: string; epoch: number; result: Result<T> } | null>(null);
  const generation = useRef(0);
  const refresh = () => { generation.current++; setEpoch(n => n + 1); };
  useEffect(() => { if (!recheckOnFocus) return; const focus = () => { generation.current++; setEpoch(n => n + 1); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [recheckOnFocus]);
  useEffect(() => {
    const request = ++generation.current; let active = true;
    void Promise.resolve().then(load).catch(() => failure<T>()).then(result => { if (active && request === generation.current) setState({ key, epoch, result }); });
    return () => { active = false; generation.current++; };
  }, [key, epoch, load]);
  return { result: state?.key === key && state.epoch === epoch ? state.result : null, refresh };
}
export function ContentFailure({ message, retry }: { message: string; retry: () => void }) { return <InlineNotice tone="error">{message}<Button intent="secondary" onClick={retry}>重试</Button></InlineNotice>; }
export function DevelopmentNotice({ client, developmentOnly = false }: { client: ContentClient; developmentOnly?: boolean }) {
  return client.mode === 'mock' || developmentOnly ? <InlineNotice tone="warning">开发示例 · 仅用于工程验证，未经正式文化内容审核。未配置真实人物，不作为匠人身份、经历或文化事实依据。</InlineNotice> : null;
}
export function ContentPicture({ media, eager = false }: { media: Media; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className="m11-picture" style={{ aspectRatio: `${media.width} / ${media.height}` }}>{failed ? <div role="img" aria-label={`图片加载失败：${media.alt}`}>图片加载失败<br />{media.alt}</div> : <img src={media.url} alt={media.alt} width={media.width} height={media.height} loading={eager ? 'eager' : 'lazy'} onError={() => setFailed(true)} />}</div>;
}
export function Sources({ sources }: { sources: Story['sources'] }) {
  return <div className="m11-sources">{sources.map((s, index) => <div key={index}><h3>{s.title}</h3><p>{s.author} · 访问日期：<time dateTime={s.accessedAt}>{s.accessedAt.slice(0, 10)}</time></p><p>{s.citation}</p><p>{s.note}</p>{s.url && <a href={s.url} target="_blank" rel="noopener noreferrer">来源：{s.title}（新标签页）</a>}</div>)}</div>;
}
