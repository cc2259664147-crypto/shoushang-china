import { useEffect, useRef, useState } from 'react';
import type { CutOperation, PapercutCore, PapercutState } from '@shoushang/contracts';
import type { ArtworkRenderer } from '@shoushang/contracts';

export type Candidate = Omit<CutOperation, 'id' | 'order'>;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function WorkshopCanvas({ state, candidate, onCandidate, core, renderer, view }: { state: PapercutState; candidate: Candidate | null; onCandidate: (candidate: Candidate) => void; core: PapercutCore; renderer: ArtworkRenderer; view: 'folded' | 'unfolded' }) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 480 });
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  useEffect(() => { const element = surface.current; if (!element) return; const observer = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect && rect.width > 0 && rect.height > 0) setSize({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) }); }); observer.observe(element); return () => { drag.current = null; observer.disconnect(); }; }, []);
  const preview = renderer.render({ work: state.work, width: size.width, height: size.height, view });
  const scale = Math.min(size.width, size.height), left = (size.width - scale) / 2, top = (size.height - scale) / 2;
  const candidateWork = candidate ? { ...state.work, operations: [...state.work.operations, { ...candidate, id: 'candidate-check', order: state.work.operations.length }] } : null;
  const validity = candidateWork ? core.validate(candidateWork) : null;
  const pos = (event: React.PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); const box = Math.min(rect.width, rect.height); return { x: clamp((event.clientX - rect.left - (rect.width - box) / 2) / box), y: clamp((event.clientY - rect.top - (rect.height - box) / 2) / box) }; };
  const move = (event: React.PointerEvent<HTMLDivElement>) => { if (!candidate || !drag.current || drag.current.id !== event.pointerId) return; const p = pos(event); onCandidate({ ...candidate, center: { x: clamp(p.x + drag.current.dx), y: clamp(p.y + drag.current.dy) } }); };
  const end = (event: React.PointerEvent<HTMLDivElement>) => { if (drag.current?.id === event.pointerId) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } };
  return <div className="ws-canvas-wrap"><div ref={surface} className="ws-canvas" role="group" aria-label="剪纸画布" onPointerDown={event => { if (!candidate || view !== 'folded') return; const p = pos(event); const near = Math.hypot((p.x - candidate.center.x) * scale, (p.y - candidate.center.y) * scale) < Math.max(24, candidate.width * scale); drag.current = { id: event.pointerId, dx: near ? candidate.center.x - p.x : 0, dy: near ? candidate.center.y - p.y : 0 }; event.currentTarget.setPointerCapture(event.pointerId); if (!near) onCandidate({ ...candidate, center: p }); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    {preview.ok ? <div className="ws-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: preview.value.svg }} /> : <p role="alert">预览失败：{preview.error.message}</p>}
    {candidate && view === 'folded' && <div className={`ws-candidate ${validity?.ok ? '' : 'ws-candidate--invalid'}`} aria-hidden="true" style={{ left: left + candidate.center.x * scale, top: top + candidate.center.y * scale, width: candidate.width * scale, height: candidate.height * scale, transform: `translate(-50%,-50%) rotate(${candidate.angleDeg}deg)`, borderRadius: candidate.shape === 'circle' ? '50%' : undefined, clipPath: candidate.shape === 'triangle' ? 'polygon(50% 0,0 100%,100% 100%)' : candidate.shape === 'teardrop' ? 'polygon(50% 0,8% 65%,25% 95%,75% 95%,92% 65%)' : undefined }} />}
  </div>{candidate && view === 'folded' && <p className={validity?.ok ? 'ws-valid' : 'ws-invalid'} role="status">{validity?.ok ? '候选切口可确认。' : `候选不可剪：${validity?.error.message ?? ''}`}</p>}</div>;
}
