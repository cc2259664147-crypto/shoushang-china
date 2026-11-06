import { useEffect, useRef, useState } from 'react';
import { ContentLink } from '../features/stories/content';
import type { Navigate } from '../features/stories/content';
import '../features/home/home.css';

/** Inline disclosure, never a Dialog: no nested modal or extra focus trap. */
export function SiteNav({ navigate, url }: { navigate: Navigate; url: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [url]);
  const links = [['/gallery', '展馆'], ['/stories', '匠人故事'], ['/my/works', '我的作品库'], ['/my/favorites', '收藏夹'], ['/#about', '关于与来源']] as const;
  return <header className="m11-nav ss-theme" onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); toggle.current?.focus(); } }}><nav className="m11-nav-row" aria-label="全站导航"><ContentLink className="m11-brand" href="/" navigate={navigate}>手上中国 · 首页</ContentLink><button ref={toggle} aria-expanded={open} aria-controls="m11-site-links" onClick={() => setOpen(v => !v)}>{open ? '关闭导航' : '打开导航'}</button><div id="m11-site-links" className="m11-nav-links" data-open={open}>{links.map(([href, label]) => <ContentLink key={href} href={href} current={href === '/#about' ? url.endsWith('/#about') : new URL(url, location.origin).pathname === href || new URL(url, location.origin).pathname.startsWith(`${href}/`)} navigate={target => { setOpen(false); toggle.current?.focus(); navigate(target); }}>{label}</ContentLink>)}</div></nav></header>;
}
