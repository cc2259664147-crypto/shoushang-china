import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CutOperation, PapercutCore, PapercutState } from '@shoushang/contracts';
import type { ArtworkRenderer } from '@shoushang/contracts';
import { canvasMetrics, paperToScreen, screenToPaper } from './editor/coordinates';
import type { CanvasSize, ScreenPoint, Viewport } from './editor/coordinates';
import { constrainViewport, fitViewport, MAX_ZOOM, MIN_ZOOM, panBy, zoomAt } from './editor/viewport';

export type Candidate = Omit<CutOperation, 'id' | 'order'>;
interface PinchGesture { pointerIds: readonly [number, number]; startViewport: Viewport; startCenter: ScreenPoint; startDistance: number }
const midpoint = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const editableTarget = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
export function WorkshopCanvas({ state, candidate, onCandidate, core, renderer, view }: { state: PapercutState; candidate: Candidate | null; onCandidate: (candidate: Candidate) => void; core: PapercutCore; renderer: ArtworkRenderer; view: 'folded' | 'unfolded' }) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 480, height: 480 });
  const sizeRef = useRef(size);
  const [viewport, setViewport] = useState<Viewport>(fitViewport);
  const viewportRef = useRef(viewport);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const pan = useRef<{ id: number; last: ScreenPoint } | null>(null);
  const touchPoints = useRef(new Map<number, ScreenPoint>());
  const pinch = useRef<PinchGesture | null>(null);
  const touchPinch = useRef<PinchGesture | null>(null);
  const spacePressed = useRef(false);
  const hovered = useRef(false);
  sizeRef.current = size;
  viewportRef.current = viewport;

  const zoomFromCenter = (factor: number) => {
    const currentSize = sizeRef.current;
    const center = { x: currentSize.width / 2, y: currentSize.height / 2 };
    setViewport(current => constrainViewport(zoomAt(current, current.zoom * factor, center, currentSize), currentSize));
  };

  const cancelGestures = () => {
    const element = surface.current;
    const pointerIds = new Set<number>(touchPoints.current.keys());
    if (drag.current) pointerIds.add(drag.current.id);
    if (pan.current) pointerIds.add(pan.current.id);
    if (pinch.current) pinch.current.pointerIds.forEach(id => pointerIds.add(id));
    pointerIds.forEach(id => { if (element?.hasPointerCapture(id)) element.releasePointerCapture(id); });
    drag.current = null;
    pan.current = null;
    pinch.current = null;
    touchPinch.current = null;
    touchPoints.current.clear();
  };

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        const next = { width: rect.width, height: rect.height };
        setSize(next);
        setViewport(current => constrainViewport(current, next));
      }
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelGestures();
      const inCanvas = hovered.current || element.contains(document.activeElement);
      if (!inCanvas || editableTarget(event.target)) return;
      if (event.key === '0') { setViewport(fitViewport()); event.preventDefault(); }
      else if (event.key === '+' || event.key === '=') { zoomFromCenter(1.25); event.preventDefault(); }
      else if (event.key === '-') { zoomFromCenter(0.8); event.preventDefault(); }
      if (event.code === 'Space' && !event.repeat) {
        spacePressed.current = true;
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') spacePressed.current = false; };
    const onBlur = () => { spacePressed.current = false; cancelGestures(); };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const currentSize = sizeRef.current;
      const requested = viewportRef.current.zoom * Math.exp(-event.deltaY * 0.0015);
      setViewport(constrainViewport(zoomAt(viewportRef.current, requested, anchor, currentSize), currentSize));
    };
    observer.observe(element);
    element.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      cancelGestures();
      observer.disconnect();
      element.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const preview = renderer.render({ work: state.work, width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)), view });
  const metrics = canvasMetrics(size);
  const candidateWork = candidate ? { ...state.work, operations: [...state.work.operations, { ...candidate, id: 'candidate-check', order: state.work.operations.length }] } : null;
  const validity = candidateWork ? core.validate(candidateWork) : null;
  const localPoint = (event: ReactPointerEvent<HTMLDivElement>): ScreenPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const paperPoint = (event: ReactPointerEvent<HTMLDivElement>) => screenToPaper(localPoint(event), viewportRef.current, size);
  const release = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const beginPinch = () => {
    const entries = [...touchPoints.current.entries()];
    const first = entries[0], second = entries[1];
    if (!first || !second) return;
    const startDistance = distance(first[1], second[1]);
    if (startDistance <= 0) return;
    drag.current = null;
    pan.current = null;
    pinch.current = { pointerIds: [first[0], second[0]], startViewport: viewportRef.current, startCenter: midpoint(first[1], second[1]), startDistance };
  };

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const points = (event: TouchEvent): readonly [ScreenPoint, ScreenPoint] | null => {
      const first = event.touches[0], second = event.touches[1];
      if (!first || !second) return null;
      const rect = element.getBoundingClientRect();
      return [
        { x: first.clientX - rect.left, y: first.clientY - rect.top },
        { x: second.clientX - rect.left, y: second.clientY - rect.top },
      ];
    };
    const onTouchStart = (event: TouchEvent) => {
      const pair = points(event);
      if (!pair) return;
      const startDistance = distance(pair[0], pair[1]);
      if (startDistance <= 0) return;
      event.preventDefault();
      drag.current = null;
      pan.current = null;
      touchPinch.current = { pointerIds: [event.touches[0]?.identifier ?? 0, event.touches[1]?.identifier ?? 1], startViewport: viewportRef.current, startCenter: midpoint(pair[0], pair[1]), startDistance };
    };
    const onTouchMove = (event: TouchEvent) => {
      const active = touchPinch.current;
      const pair = points(event);
      if (!active || !pair) return;
      event.preventDefault();
      const currentSize = sizeRef.current;
      const center = midpoint(pair[0], pair[1]);
      const scaled = zoomAt(active.startViewport, active.startViewport.zoom * distance(pair[0], pair[1]) / active.startDistance, active.startCenter, currentSize);
      setViewport(constrainViewport(panBy(scaled, { x: center.x - active.startCenter.x, y: center.y - active.startCenter.y }), currentSize));
    };
    const onTouchEnd = (event: TouchEvent) => { if (event.touches.length < 2) touchPinch.current = null; };
    element.addEventListener('touchstart', onTouchStart, { passive: false });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);
    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    const point = localPoint(event);
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, point);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touchPoints.current.size >= 2) { beginPinch(); event.preventDefault(); return; }
    }
    const navigation = event.button === 1 || (event.button === 0 && spacePressed.current);
    if (navigation) {
      pan.current = { id: event.pointerId, last: point };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || !candidate || view !== 'folded') return;
    const paper = paperPoint(event);
    const center = paperToScreen(candidate.center, viewportRef.current, size);
    const near = distance(point, center) < Math.max(24, candidate.width * metrics.base * viewportRef.current.zoom);
    drag.current = { id: event.pointerId, dx: near ? candidate.center.x - paper.x : 0, dy: near ? candidate.center.y - paper.y : 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!near) onCandidate({ ...candidate, center: paper });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = localPoint(event);
    if (event.pointerType === 'touch' && touchPoints.current.has(event.pointerId)) touchPoints.current.set(event.pointerId, point);
    const activePinch = pinch.current;
    if (activePinch) {
      const first = touchPoints.current.get(activePinch.pointerIds[0]), second = touchPoints.current.get(activePinch.pointerIds[1]);
      if (!first || !second) return;
      const center = midpoint(first, second);
      const scaled = zoomAt(activePinch.startViewport, activePinch.startViewport.zoom * distance(first, second) / activePinch.startDistance, activePinch.startCenter, size);
      setViewport(constrainViewport(panBy(scaled, { x: center.x - activePinch.startCenter.x, y: center.y - activePinch.startCenter.y }), size));
      return;
    }
    if (pan.current?.id === event.pointerId) {
      const last = pan.current.last;
      pan.current.last = point;
      setViewport(current => constrainViewport(panBy(current, { x: point.x - last.x, y: point.y - last.y }), size));
      return;
    }
    if (!candidate || drag.current?.id !== event.pointerId) return;
    const paper = paperPoint(event);
    onCandidate({ ...candidate, center: { x: paper.x + drag.current.dx, y: paper.y + drag.current.dy } });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    touchPoints.current.delete(event.pointerId);
    if (pinch.current?.pointerIds.includes(event.pointerId)) pinch.current = null;
    if (pan.current?.id === event.pointerId) pan.current = null;
    if (drag.current?.id === event.pointerId) drag.current = null;
    release(event);
  };

  const transformX = viewport.pan.x + (1 - viewport.zoom) * metrics.origin.x;
  const transformY = viewport.pan.y + (1 - viewport.zoom) * metrics.origin.y;
  return <div className="ws-canvas-wrap"><div ref={surface} className="ws-canvas" role="group" aria-label="剪纸画布" tabIndex={0} data-zoom={viewport.zoom.toFixed(3)}
    onPointerEnter={() => { hovered.current = true; }} onPointerLeave={() => { hovered.current = false; }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd}
    onPointerCancel={event => { if (!(event.pointerType === 'touch' && touchPinch.current)) cancelGestures(); release(event); }}
    onLostPointerCapture={event => { touchPoints.current.delete(event.pointerId); if (!touchPinch.current && (pan.current?.id === event.pointerId || drag.current?.id === event.pointerId || pinch.current?.pointerIds.includes(event.pointerId))) cancelGestures(); }}>
    <div className="ws-viewport-layer" style={{ transform: `matrix(${viewport.zoom},0,0,${viewport.zoom},${transformX},${transformY})` }}>
      {preview.ok ? <div className="ws-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: preview.value.svg }} /> : <p role="alert">预览失败：{preview.error.message}</p>}
      {candidate && view === 'folded' && <div className={`ws-candidate ${validity?.ok ? '' : 'ws-candidate--invalid'}`} aria-hidden="true" style={{ left: metrics.origin.x + candidate.center.x * metrics.base, top: metrics.origin.y + candidate.center.y * metrics.base, width: candidate.width * metrics.base, height: candidate.height * metrics.base, transform: `translate(-50%,-50%) rotate(${candidate.angleDeg}deg)`, borderRadius: candidate.shape === 'circle' ? '50%' : undefined, clipPath: candidate.shape === 'triangle' ? 'polygon(50% 0,0 100%,100% 100%)' : candidate.shape === 'teardrop' ? 'polygon(50% 0,8% 65%,25% 95%,75% 95%,92% 65%)' : undefined }} />}
    </div>
  </div><div className="ws-viewport-controls" aria-label="画布视图控制">
    <button type="button" aria-label="缩小画布" disabled={viewport.zoom <= MIN_ZOOM} onClick={() => zoomFromCenter(0.8)}>−</button>
    <output aria-label="画布缩放比例">{Math.round(viewport.zoom * 100)}%</output>
    <button type="button" aria-label="放大画布" disabled={viewport.zoom >= MAX_ZOOM} onClick={() => zoomFromCenter(1.25)}>＋</button>
    <button type="button" onClick={() => setViewport(fitViewport())}>适配画布</button>
  </div>{candidate && view === 'folded' && <p className={validity?.ok ? 'ws-valid' : 'ws-invalid'} role="status">{validity?.ok ? '候选切口可确认。' : `候选不可剪：${validity?.error.message ?? ''}`}</p>}</div>;
}
