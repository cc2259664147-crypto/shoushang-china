import { useEffect, useRef } from 'react';
interface Position { id: string; offset: number; y: number }
const positions = new Map<string, Position>();
export function rememberStory(url: string, id: string) {
  const value: Position = { id, offset: document.getElementById(`story-${id}`)?.getBoundingClientRect().top ?? 0, y: scrollY };
  positions.set(url, value);
  try { sessionStorage.setItem(`m11-position:${url}`, JSON.stringify(value)); } catch { /* Optional position storage. */ }
}
export function useStoryPosition(url: string, ready: boolean) {
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || restored.current === url) return;
    restored.current = url;
    let position: Position | null = positions.get(url) ?? null;
    try { const data: unknown = JSON.parse(sessionStorage.getItem(`m11-position:${url}`) ?? 'null'); if (!position && data && typeof data === 'object' && 'id' in data && typeof data.id === 'string' && 'offset' in data && typeof data.offset === 'number' && Number.isFinite(data.offset) && 'y' in data && typeof data.y === 'number' && Number.isFinite(data.y)) position = data as Position; } catch { /* Optional; same-tab memory remains available. */ }
    if (!position) { scrollTo(0, 0); return; }
    const saved = position;
    const anchor = document.getElementById(`story-${saved.id}`);
    const restore = () => { if (anchor?.isConnected) scrollBy(0, anchor.getBoundingClientRect().top - saved.offset); else scrollTo(0, saved.y); };
    anchor?.focus({ preventScroll: true }); restore();
    const observer = new ResizeObserver(restore); observer.observe(document.documentElement);
    const stop = () => observer.disconnect(); const timer = setTimeout(stop, 1500);
    const events = ['wheel', 'touchstart', 'keydown'] as const;
    events.forEach(event => window.addEventListener(event, stop, { once: true }));
    return () => { clearTimeout(timer); stop(); events.forEach(event => window.removeEventListener(event, stop)); };
  }, [url, ready]);
}
