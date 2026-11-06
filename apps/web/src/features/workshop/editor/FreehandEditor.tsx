import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import type { PapercutCommandV2, RawPointV2, WorkV2 } from '@shoushang/contracts';
import { generateUuid } from '@shoushang/content-client';
import { FREEHAND_GEOMETRY_LIMITS_V2 } from '@shoushang/papercut-core';
import type { ArtworkRendererV2 } from '@shoushang/artwork-renderer';
import { canvasMetrics, screenToPaper, type CanvasSize, type ScreenPoint, type Viewport } from './coordinates';
import {
  BRUSH_WIDTH_DEFAULT,
  BRUSH_WIDTH_STEP,
  brushWidthFromSlider,
  canBeginFreehand,
  defaultBrushCandidateId,
  FreehandStrokeBuffer,
  orderedPointerSamples,
  submitBrushStroke,
  submitFreehandStroke,
  VisibleTrailScheduler,
  type FreehandPhase,
} from './freehand';
import { BrushOverlay } from './BrushOverlay';
import { FreehandOverlay } from './FreehandOverlay';
import {
  canBeginLine,
  defaultLineCandidateId,
  isLineLongEnough,
  LINE_TOO_SHORT_MESSAGE,
  lineDragEnd,
  lineScreenDistance,
  submitLineStroke,
  type LineDrag,
} from './line';
import { ParametricOverlay } from './ParametricOverlay';
import {
  allowedParametricShapes,
  canBeginParametric,
  isParametricShape,
  makeParametricOperation,
  type ParametricDrag,
} from './parametric';
import { SelectionOverlay } from './SelectionOverlay';
import {
  DragPreviewScheduler,
  beginParametricTransform,
  dragTranslation,
  parametricTransformPreview as calculateParametricTransformPreview,
  selectableCuts,
  selectedCut,
  topmostCutAt,
  type CutDrag,
  type ParametricTransformDrag,
  type ParametricTransformPreview,
  type ScaleHandle,
} from './selection';
import { EDITOR_TOOLS, toolDescription, toolForShortcut, toolLabel, type EditorTool } from './tools';
import { constrainViewport, fitViewport, panBy, zoomAt } from './viewport';
import type { EditorWorkerController } from './worker/controller';
import {
  parametricPropertyDraft,
  parseParametricPropertyDraft,
  screenPixelNudge,
  type ParametricPropertyDraft,
} from './property-edit';
import './freehand-editor.css';

export interface FreehandEditorProps {
  readonly work: WorkV2;
  readonly controller: EditorWorkerController;
  readonly renderer: ArtworkRendererV2;
  readonly onConfirmedWork: (work: WorkV2) => void;
  readonly candidateIdFactory?: () => string;
  readonly brushCandidateIdFactory?: () => string;
  readonly lineCandidateIdFactory?: () => string;
  readonly parametricCandidateIdFactory?: () => string;
}

interface PanGesture { readonly pointerId: number; readonly last: ScreenPoint }
interface PinchGesture {
  readonly pointerIds: readonly [number, number];
  readonly startViewport: Viewport;
  readonly startCenter: ScreenPoint;
  readonly startDistance: number;
}

const phaseText = (phase: FreehandPhase, tool: EditorTool): string => {
  if (phase.kind === 'drawing') {
    if (tool === 'select') return '正在调整图形，松开完成';
    if (tool === 'brush') return '正在剪除，松开完成';
    if (tool === 'line') return '正在绘制直线，松开完成';
    if (isParametricShape(tool)) return '正在绘制图形，松开完成';
    return '正在绘制，松开以闭合';
  }
  if (phase.kind === 'validating') return phase.message ?? '正在校验闭合区域';
  if (phase.kind === 'error') return phase.message;
  return '空闲';
};

const HELP_DISMISSED_KEY = 'shoushang-editor-help-dismissed-v1';

function initiallyShowHelp(): boolean {
  try { return window.localStorage.getItem(HELP_DISMISSED_KEY) !== '1'; } catch { return true; }
}

const defaultCandidateId = (): string => `freehand-${generateUuid()}`;
const defaultParametricCandidateId = (): string => `parametric-${generateUuid()}`;
const center = (first: ScreenPoint, second: ScreenPoint): ScreenPoint => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
const distance = (first: ScreenPoint, second: ScreenPoint): number => Math.hypot(second.x - first.x, second.y - first.y);

export function FreehandEditor({ work, controller, renderer, onConfirmedWork, candidateIdFactory = defaultCandidateId, brushCandidateIdFactory = defaultBrushCandidateId, lineCandidateIdFactory = defaultLineCandidateId, parametricCandidateIdFactory = defaultParametricCandidateId }: FreehandEditorProps) {
  const [helpOpen, setHelpOpen] = useState(initiallyShowHelp);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const helpCloseRef = useRef<HTMLButtonElement | null>(null);
  const [tool, setTool] = useState<EditorTool>('select');
  const [view, setView] = useState<'folded' | 'unfolded'>('folded');
  const [phase, setPhase] = useState<FreehandPhase>({ kind: 'idle' });
  const [visiblePoints, setVisiblePoints] = useState<readonly RawPointV2[]>([]);
  const [brushWidth, setBrushWidth] = useState<number>(BRUSH_WIDTH_DEFAULT);
  const [confirmedWork, setConfirmedWork] = useState(work);
  const [size, setSize] = useState<CanvasSize>({ width: 640, height: 640 });
  const [viewport, setViewport] = useState<Viewport>(fitViewport);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<CutDrag | null>(null);
  const [transformPreview, setTransformPreview] = useState<ParametricTransformPreview | null>(null);
  const [parametricPreview, setParametricPreview] = useState<ParametricDrag | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [propertyDraft, setPropertyDraft] = useState<ParametricPropertyDraft | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearConfirmRef = useRef<HTMLButtonElement | null>(null);
  const clearDialogRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<FreehandPhase>(phase);
  const confirmedWorkRef = useRef(confirmedWork);
  const viewportRef = useRef(viewport);
  const selectedIdRef = useRef<string | null>(null);
  const workIdRef = useRef(work.id);
  const activePointer = useRef<number | null>(null);
  const touchPoints = useRef(new Map<number, ScreenPoint>());
  const panGesture = useRef<PanGesture | null>(null);
  const pinchGesture = useRef<PinchGesture | null>(null);
  const stroke = useRef(new FreehandStrokeBuffer());
  const drag = useRef<CutDrag | null>(null);
  const transformDrag = useRef<ParametricTransformDrag | null>(null);
  const parametricDrag = useRef<ParametricDrag | null>(null);
  const lineDrag = useRef<LineDrag | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const scheduler = useRef<VisibleTrailScheduler | null>(null);
  const dragScheduler = useRef<DragPreviewScheduler | null>(null);
  if (scheduler.current === null) {
    scheduler.current = new VisibleTrailScheduler(
      callback => requestAnimationFrame(callback),
      handle => cancelAnimationFrame(handle),
      points => { if (mounted.current) setVisiblePoints(points); },
    );
  }
  if (dragScheduler.current === null) {
    dragScheduler.current = new DragPreviewScheduler(
      callback => requestAnimationFrame(callback),
      handle => cancelAnimationFrame(handle),
      next => { if (mounted.current) setDragPreview(next); },
    );
  }

  function closeHelp(): void {
    try { window.localStorage.setItem(HELP_DISMISSED_KEY, '1'); } catch { /* Closing remains available without storage. */ }
    setHelpOpen(false);
    helpButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!helpOpen || clearDialogOpen) return;
    helpCloseRef.current?.focus();
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeHelp();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [helpOpen, clearDialogOpen]);

  function updatePhase(next: FreehandPhase): void {
    phaseRef.current = next;
    setPhase(next);
  }

  function updateViewport(next: Viewport): void {
    viewportRef.current = next;
    setViewport(next);
  }

  function updateSelected(next: string | null): void {
    selectedIdRef.current = next;
    setSelectedId(next);
  }

  function releaseCapture(pointerId: number): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId); } catch { /* pointer already ended */ }
  }

  function cancelStroke(message?: string): void {
    generation.current += 1;
    const pointerId = activePointer.current;
    activePointer.current = null;
    if (pointerId !== null) releaseCapture(pointerId);
    scheduler.current!.cancel();
    dragScheduler.current!.cancel();
    stroke.current.cancel();
    drag.current = null;
    transformDrag.current = null;
    parametricDrag.current = null;
    lineDrag.current = null;
    setDragPreview(null);
    setTransformPreview(null);
    setParametricPreview(null);
    setVisiblePoints([]);
    updatePhase(message ? { kind: 'error', message } : { kind: 'idle' });
  }

  function pointInCanvas(sample: { readonly clientX: number; readonly clientY: number }): RawPointV2 {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('画布尚未挂载');
    const rect = canvas.getBoundingClientRect();
    return screenToPaper(
      { x: sample.clientX - rect.left, y: sample.clientY - rect.top },
      viewportRef.current,
      { width: rect.width, height: rect.height },
    );
  }

  function localPoint(clientX: number, clientY: number): ScreenPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startPinch(): void {
    const entries = [...touchPoints.current.entries()];
    if (entries.length < 2) return;
    const first = entries[0]!, second = entries[1]!;
    const firstLocal = localPoint(first[1].x, first[1].y), secondLocal = localPoint(second[1].x, second[1].y);
    pinchGesture.current = {
      pointerIds: [first[0], second[0]],
      startViewport: viewportRef.current,
      startCenter: center(firstLocal, secondLocal),
      startDistance: Math.max(1, distance(firstLocal, secondLocal)),
    };
    const canvas = canvasRef.current!;
    for (const pointerId of pinchGesture.current.pointerIds) {
      try { canvas.setPointerCapture(pointerId); } catch { /* browser may have ended a pointer */ }
    }
  }

  useEffect(() => {
    const switchedWork = workIdRef.current !== work.id;
    workIdRef.current = work.id;
    confirmedWorkRef.current = work;
    setConfirmedWork(work);
    cancelStroke();
    if (switchedWork || !selectedCut(work, selectedIdRef.current)) updateSelected(null);
  }, [work]);

  useEffect(() => controller.subscribe(snapshot => {
    setCanUndo(snapshot.canUndo);
    setCanRedo(snapshot.canRedo);
    if (snapshot.notice) {
      cancelStroke(snapshot.notice);
      return;
    }
    if (!snapshot.lastConfirmedWork) return;
    confirmedWorkRef.current = snapshot.lastConfirmedWork;
    setConfirmedWork(snapshot.lastConfirmedWork);
    if (!selectedCut(snapshot.lastConfirmedWork, selectedIdRef.current)) updateSelected(null);
    if (phaseRef.current.kind === 'drawing' || drag.current) cancelStroke();
  }), [controller]);

  useEffect(() => {
    if (clearDialogOpen) clearConfirmRef.current?.focus();
  }, [clearDialogOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      scheduler.current?.cancel();
      dragScheduler.current?.cancel();
      stroke.current.cancel();
      drag.current = null;
      transformDrag.current = null;
      parametricDrag.current = null;
      lineDrag.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ids = new Set([...touchPoints.current.keys(), ...(activePointer.current === null ? [] : [activePointer.current])]);
        for (const pointerId of ids) {
          try { if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId); } catch { /* pointer already ended */ }
        }
      }
      activePointer.current = null;
      touchPoints.current.clear();
      panGesture.current = null;
      pinchGesture.current = null;
    };
  }, []);

  const renderResult = useMemo(() => {
    const dimension = Math.max(1, Math.min(size.width, size.height));
    return renderer.render({ work: confirmedWork, width: dimension, height: dimension, view });
  }, [confirmedWork, renderer, size.height, size.width, view]);
  const chosenCut = useMemo(() => selectedCut(confirmedWork, selectedId), [confirmedWork, selectedId]);
  const cuts = useMemo(() => selectableCuts(confirmedWork), [confirmedWork]);
  const allowedShapes = useMemo(() => allowedParametricShapes(confirmedWork), [confirmedWork]);
  const visibleTools = useMemo(() => EDITOR_TOOLS.filter(item => !isParametricShape(item.id) || allowedShapes.includes(item.id)), [allowedShapes]);
  const previewDelta = dragPreview ? dragTranslation(dragPreview) : { dx: 0, dy: 0 };
  const metrics = canvasMetrics(size);

  useEffect(() => {
    setPropertyDraft(chosenCut?.operation.kind === 'parametric' ? parametricPropertyDraft(chosenCut.operation) : null);
  }, [chosenCut]);

  function restorePropertyDraft(message?: string): void {
    const selected = selectedCut(confirmedWorkRef.current, selectedIdRef.current);
    setPropertyDraft(selected?.operation.kind === 'parametric' ? parametricPropertyDraft(selected.operation) : null);
    if (message) updatePhase({ kind: 'error', message });
    else if (phaseRef.current.kind === 'error') updatePhase({ kind: 'idle' });
  }

  function chooseTool(next: EditorTool): void {
    if (phaseRef.current.kind === 'validating') return;
    if (next === 'line' && !confirmedWorkRef.current.editorProfileSnapshot.allowedTools.freehand.enabled) return;
    cancelStroke();
    panGesture.current = null;
    pinchGesture.current = null;
    setTool(next);
  }

  function chooseView(next: 'folded' | 'unfolded'): void {
    if (phaseRef.current.kind === 'validating') return;
    cancelStroke();
    if (next === 'unfolded') updateSelected(null);
    setView(next);
  }

  function confirmCommand(command: PapercutCommandV2, message: string, clearSelection = false, onRejected?: (message: string) => void): void {
    if (phaseRef.current.kind === 'validating') return;
    updatePhase({ kind: 'validating', message });
    const dispatchGeneration = generation.current;
    void controller.dispatch(command).then(nextWork => {
      if (!mounted.current || dispatchGeneration !== generation.current) return;
      confirmedWorkRef.current = nextWork;
      setConfirmedWork(nextWork);
      setDragPreview(null);
      setTransformPreview(null);
      if (command.type === 'duplicate-cut') updateSelected(command.newOperationId);
      else if (clearSelection || !selectedCut(nextWork, selectedIdRef.current)) updateSelected(null);
      updatePhase({ kind: 'idle' });
      onConfirmedWork(nextWork);
    }).catch(cause => {
      if (!mounted.current || dispatchGeneration !== generation.current) return;
      setDragPreview(null);
      setTransformPreview(null);
      const detail = cause instanceof Error ? cause.message : '编辑操作失败';
      const error = command.type === 'duplicate-cut' ? `复制失败：${detail}` : detail;
      updatePhase({ kind: 'error', message: error });
      onRejected?.(error);
    });
  }

  function applyPropertyDraft(): void {
    const operationId = selectedIdRef.current;
    const selected = selectedCut(confirmedWorkRef.current, operationId);
    if (!operationId || selected?.operation.kind !== 'parametric' || !propertyDraft || phaseRef.current.kind === 'validating') return;
    const parsed = parseParametricPropertyDraft(propertyDraft);
    if (!parsed.ok) {
      restorePropertyDraft(`无法应用属性：${parsed.message}`);
      return;
    }
    confirmCommand({
      type: 'update-cut',
      operationId,
      change: { type: 'transform-parametric', ...parsed.value },
    }, '正在校验属性', false, error => restorePropertyDraft(`无法应用属性：${error}`));
  }

  function duplicateSelection(): boolean {
    const operationId = selectedIdRef.current;
    if (!operationId || tool !== 'select' || view !== 'folded' || phaseRef.current.kind === 'validating' || drag.current || transformDrag.current) return false;
    const horizontal = screenPixelNudge('ArrowRight', 12, viewportRef.current, size);
    const vertical = screenPixelNudge('ArrowDown', 12, viewportRef.current, size);
    confirmCommand({ type: 'duplicate-cut', operationId, newOperationId: `cut-${generateUuid()}`, dx: horizontal.dx, dy: vertical.dy }, '正在复制切口');
    return true;
  }

  function deleteSelection(): void {
    const operationId = selectedIdRef.current;
    if (!operationId || view !== 'folded' || phaseRef.current.kind === 'validating' || drag.current || transformDrag.current) return;
    confirmCommand({ type: 'delete-cut', operationId }, '正在删除切口', true);
  }

  function selectNextCut(): void {
    if (tool !== 'select' || view !== 'folded' || phaseRef.current.kind === 'validating' || drag.current || transformDrag.current || cuts.length === 0) return;
    const current = cuts.findIndex(cut => cut.id === selectedIdRef.current);
    updateSelected(cuts[(current + 1) % cuts.length]!.id);
    canvasRef.current?.focus();
  }

  function undo(): void {
    if (!canUndo || view !== 'folded' || phaseRef.current.kind === 'validating' || drag.current || transformDrag.current) return;
    confirmCommand({ type: 'undo' }, '正在撤销');
  }

  function redo(): void {
    if (!canRedo || view !== 'folded' || phaseRef.current.kind === 'validating' || drag.current || transformDrag.current) return;
    confirmCommand({ type: 'redo' }, '正在重做');
  }

  function closeClearDialog(): void {
    setClearDialogOpen(false);
    clearButtonRef.current?.focus();
    requestAnimationFrame(() => clearButtonRef.current?.focus());
  }

  function confirmClear(): void {
    closeClearDialog();
    confirmCommand({ type: 'clear-cuts' }, '正在清空切口', true);
  }

  function handleClearDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      closeClearDialog();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...(clearDialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const first = buttons[0], last = buttons.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !clearDialogRef.current?.contains(document.activeElement))) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const canvas = event.currentTarget;
    // 聚焦仅为接收键盘快捷键；preventScroll 避免按下瞬间滚动页面而改变命中的纸面坐标。
    canvas.focus({ preventScroll: true });
    if (phaseRef.current.kind === 'validating') return;
    const touchCountBefore = touchPoints.current.size;
    if (event.pointerType === 'touch') touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (event.pointerType === 'touch' && touchPoints.current.size >= 2) {
      if (phaseRef.current.kind === 'drawing' || drag.current) cancelStroke();
      startPinch();
      event.preventDefault();
      return;
    }

    const middleMouse = event.pointerType === 'mouse' && event.button === 1;
    const primaryPan = tool === 'pan' && event.button === 0 && (event.pointerType !== 'pen' || (event.buttons & 32) === 0);
    if (middleMouse || primaryPan) {
      try { canvas.setPointerCapture(event.pointerId); } catch { return; }
      panGesture.current = { pointerId: event.pointerId, last: { x: event.clientX, y: event.clientY } };
      event.preventDefault();
      return;
    }

    const primarySelection = event.button === 0 && (event.buttons & 1) === 1
      && (event.pointerType === 'mouse' || event.pointerType === 'touch' || (event.pointerType === 'pen' && event.isPrimary && (event.buttons & 32) === 0));
    const transformHandle = event.target instanceof SVGElement ? event.target.dataset.transformHandle : undefined;
    if (tool === 'select' && view === 'folded' && primarySelection && transformHandle) {
      const selected = confirmedWorkRef.current.operations.find(operation => operation.id === selectedIdRef.current);
      if (selected?.kind !== 'parametric' || !(['nw', 'ne', 'se', 'sw', 'rotate'] as const).includes(transformHandle as ScaleHandle | 'rotate')) return;
      try { canvas.setPointerCapture(event.pointerId); } catch { return; }
      const next = beginParametricTransform(selected, transformHandle as ScaleHandle | 'rotate', event.pointerId, pointInCanvas(event), event.shiftKey);
      activePointer.current = event.pointerId;
      transformDrag.current = next;
      setTransformPreview(calculateParametricTransformPreview(next));
      updatePhase({ kind: 'drawing' });
      event.preventDefault();
      return;
    }
    if (tool === 'select' && view === 'folded' && primarySelection) {
      const point = pointInCanvas(event);
      const pointerType = event.pointerType === 'pen' || event.pointerType === 'touch' ? event.pointerType : 'mouse';
      const hit = topmostCutAt(confirmedWorkRef.current, point, pointerType, viewportRef.current, size);
      updateSelected(hit?.id ?? null);
      if (!hit) return;
      try { canvas.setPointerCapture(event.pointerId); } catch { return; }
      const nextDrag: CutDrag = { pointerId: event.pointerId, operationId: hit.id, start: point, current: point };
      activePointer.current = event.pointerId;
      drag.current = nextDrag;
      setDragPreview(nextDrag);
      event.preventDefault();
      return;
    }

    if (canBeginParametric(tool, view, phaseRef.current, event, touchCountBefore, allowedShapes)) {
      try { canvas.setPointerCapture(event.pointerId); } catch { return; }
      const first = pointInCanvas(event);
      const next: ParametricDrag = { pointerId: event.pointerId, shape: tool, start: first, current: first, lockAspect: event.shiftKey };
      activePointer.current = event.pointerId;
      parametricDrag.current = next;
      setParametricPreview(next);
      updatePhase({ kind: 'drawing' });
      event.preventDefault();
      return;
    }

    if (canBeginLine(tool, view, phaseRef.current, event, touchCountBefore, confirmedWorkRef.current.editorProfileSnapshot.allowedTools.freehand.enabled)) {
      try { canvas.setPointerCapture(event.pointerId); } catch { return; }
      const first = pointInCanvas(event);
      const next: LineDrag = { pointerId: event.pointerId, start: first, current: first, snap: event.shiftKey };
      activePointer.current = event.pointerId;
      lineDrag.current = next;
      setVisiblePoints([first]);
      updatePhase({ kind: 'drawing' });
      event.preventDefault();
      return;
    }

    if (!canBeginFreehand(tool, view, phaseRef.current, event, touchCountBefore)) return;
    try { canvas.setPointerCapture(event.pointerId); } catch { return; }
    const first = pointInCanvas(event);
    activePointer.current = event.pointerId;
    stroke.current.begin(first);
    setVisiblePoints([first]);
    updatePhase({ kind: 'drawing' });
    event.preventDefault();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'touch' && touchPoints.current.has(event.pointerId)) {
      touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const pinch = pinchGesture.current;
    if (pinch?.pointerIds.includes(event.pointerId)) {
      const first = touchPoints.current.get(pinch.pointerIds[0]), second = touchPoints.current.get(pinch.pointerIds[1]);
      if (first && second) {
        const firstLocal = localPoint(first.x, first.y), secondLocal = localPoint(second.x, second.y);
        const currentCenter = center(firstLocal, secondLocal);
        const zoomed = zoomAt(pinch.startViewport, pinch.startViewport.zoom * distance(firstLocal, secondLocal) / pinch.startDistance, pinch.startCenter, size);
        updateViewport(constrainViewport(panBy(zoomed, { x: currentCenter.x - pinch.startCenter.x, y: currentCenter.y - pinch.startCenter.y }), size));
      }
      event.preventDefault();
      return;
    }
    const pan = panGesture.current;
    if (pan?.pointerId === event.pointerId) {
      updateViewport(constrainViewport(panBy(viewportRef.current, { x: event.clientX - pan.last.x, y: event.clientY - pan.last.y }), size));
      panGesture.current = { pointerId: event.pointerId, last: { x: event.clientX, y: event.clientY } };
      event.preventDefault();
      return;
    }
    if (activePointer.current === event.pointerId && transformDrag.current) {
      const next = { ...transformDrag.current, current: pointInCanvas(event), snap: event.shiftKey } as ParametricTransformDrag;
      transformDrag.current = next;
      setTransformPreview(calculateParametricTransformPreview(next));
      event.preventDefault();
      return;
    }
    if (activePointer.current === event.pointerId && drag.current) {
      drag.current = { ...drag.current, current: pointInCanvas(event) };
      dragScheduler.current!.schedule(() => drag.current!);
      event.preventDefault();
      return;
    }
    if (activePointer.current === event.pointerId && parametricDrag.current) {
      const next = { ...parametricDrag.current, current: pointInCanvas(event), lockAspect: event.shiftKey };
      parametricDrag.current = next;
      setParametricPreview(next);
      event.preventDefault();
      return;
    }
    if (activePointer.current === event.pointerId && lineDrag.current) {
      const next = { ...lineDrag.current, current: pointInCanvas(event), snap: event.shiftKey };
      lineDrag.current = next;
      setVisiblePoints([next.start, lineDragEnd(next)]);
      event.preventDefault();
      return;
    }
    if (activePointer.current !== event.pointerId || phaseRef.current.kind !== 'drawing') return;
    const samples = orderedPointerSamples(event.nativeEvent).map(pointInCanvas);
    const appended = stroke.current.append(samples);
    if (!appended.ok) {
      cancelStroke(appended.message);
      return;
    }
    scheduler.current!.schedule(() => stroke.current.snapshot());
    event.preventDefault();
  }

  function endNavigation(pointerId: number): void {
    if (panGesture.current?.pointerId === pointerId) panGesture.current = null;
    if (pinchGesture.current?.pointerIds.includes(pointerId)) pinchGesture.current = null;
    touchPoints.current.delete(pointerId);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    endNavigation(event.pointerId);
    if (activePointer.current === event.pointerId && transformDrag.current) {
      activePointer.current = null;
      releaseCapture(event.pointerId);
      const completed = transformDrag.current;
      const preview = calculateParametricTransformPreview(completed);
      transformDrag.current = null;
      setTransformPreview(preview);
      confirmCommand({
        type: 'update-cut', operationId: completed.operationId,
        change: { type: 'transform-parametric', center: preview.center, width: preview.width, height: preview.height, angleDeg: preview.angleDeg },
      }, completed.kind === 'rotate' ? '正在确认旋转' : '正在确认缩放');
      return;
    }
    if (activePointer.current === event.pointerId && drag.current) {
      activePointer.current = null;
      releaseCapture(event.pointerId);
      dragScheduler.current!.cancel();
      const completed = drag.current;
      drag.current = null;
      setDragPreview(completed);
      const { dx, dy } = dragTranslation(completed);
      if (dx === 0 && dy === 0) {
        setDragPreview(null);
        updatePhase({ kind: 'idle' });
        return;
      }
      confirmCommand({ type: 'update-cut', operationId: completed.operationId, change: { type: 'translate', dx, dy } }, '正在确认移动');
      return;
    }
    if (activePointer.current === event.pointerId && parametricDrag.current) {
      activePointer.current = null;
      releaseCapture(event.pointerId);
      const completed = { ...parametricDrag.current, current: pointInCanvas(event), lockAspect: event.shiftKey };
      parametricDrag.current = null;
      setParametricPreview(null);
      const prepared = makeParametricOperation(confirmedWorkRef.current, completed, parametricCandidateIdFactory());
      if (!prepared.ok) {
        updatePhase({ kind: 'error', message: prepared.message });
        return;
      }
      confirmCommand({ type: 'add-parametric-cut', operation: prepared.operation }, '正在校验图形');
      return;
    }
    if (activePointer.current === event.pointerId && lineDrag.current) {
      activePointer.current = null;
      releaseCapture(event.pointerId);
      const completed = lineDrag.current;
      lineDrag.current = null;
      const end = lineDragEnd(completed);
      setVisiblePoints([completed.start, end]);
      if (!isLineLongEnough(lineScreenDistance(completed.start, end, viewportRef.current, size))) {
        setVisiblePoints([]);
        updatePhase({ kind: 'error', message: LINE_TOO_SHORT_MESSAGE });
        return;
      }
      updatePhase({ kind: 'validating', message: '正在校验直线' });
      const dispatchGeneration = generation.current;
      void submitLineStroke(controller, confirmedWorkRef.current, lineCandidateIdFactory(), completed.start, end, brushWidth).then(nextWork => {
        if (!mounted.current || dispatchGeneration !== generation.current) return;
        confirmedWorkRef.current = nextWork;
        setConfirmedWork(nextWork);
        setVisiblePoints([]);
        updatePhase({ kind: 'idle' });
        onConfirmedWork(nextWork);
      }).catch(cause => {
        if (!mounted.current || dispatchGeneration !== generation.current) return;
        setVisiblePoints([]);
        const message = cause instanceof Error ? cause.message : '直线校验失败';
        updatePhase({ kind: 'error', message });
      });
      return;
    }
    if (activePointer.current !== event.pointerId || phaseRef.current.kind !== 'drawing') return;
    activePointer.current = null;
    releaseCapture(event.pointerId);
    scheduler.current!.cancel();
    const rawPoints = stroke.current.freeze();
    setVisiblePoints(rawPoints);
    const dispatchGeneration = generation.current;
    const confirmed = (nextWork: WorkV2): void => {
      if (!mounted.current || dispatchGeneration !== generation.current) return;
      confirmedWorkRef.current = nextWork;
      setConfirmedWork(nextWork);
      setVisiblePoints([]);
      updatePhase({ kind: 'idle' });
      onConfirmedWork(nextWork);
    };
    if (tool === 'brush') {
      updatePhase({ kind: 'validating', message: '正在校验笔刷轨迹' });
      void submitBrushStroke(controller, confirmedWorkRef.current, brushCandidateIdFactory(), rawPoints, brushWidth).then(confirmed).catch(cause => {
        if (!mounted.current || dispatchGeneration !== generation.current) return;
        setVisiblePoints([]);
        const message = cause instanceof Error ? cause.message : '笔刷轨迹校验失败';
        updatePhase({ kind: 'error', message });
      });
      return;
    }
    updatePhase({ kind: 'validating', message: '正在校验闭合区域' });
    void submitFreehandStroke(controller, confirmedWorkRef.current, candidateIdFactory(), rawPoints).then(confirmed).catch(cause => {
      if (!mounted.current || dispatchGeneration !== generation.current) return;
      const message = cause instanceof Error ? cause.message : '自由路径校验失败';
      updatePhase({ kind: 'error', message });
    });
  }

  function handleCancellation(pointerId: number): void {
    endNavigation(pointerId);
    if (activePointer.current === pointerId) cancelStroke();
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    if (phaseRef.current.kind === 'validating') return;
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const factor = Math.exp(-event.deltaY * 0.0015);
    updateViewport(constrainViewport(zoomAt(viewportRef.current, viewportRef.current.zoom * factor, anchor, size), size));
  }

  function updateLineSnap(snap: boolean): void {
    const current = lineDrag.current;
    if (!current || current.snap === snap) return;
    const next = { ...current, snap };
    lineDrag.current = next;
    setVisiblePoints([next.start, lineDragEnd(next)]);
  }

  function updateTransformSnap(snap: boolean): void {
    const current = transformDrag.current;
    if (!current || current.snap === snap) return;
    const next = { ...current, snap } as ParametricTransformDrag;
    transformDrag.current = next;
    setTransformPreview(calculateParametricTransformPreview(next));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && (phaseRef.current.kind === 'drawing' || drag.current || parametricDrag.current)) {
      cancelStroke();
      event.preventDefault();
      return;
    }
    if (event.key === 'Shift' && (lineDrag.current || transformDrag.current)) {
      updateLineSnap(true);
      updateTransformSnap(true);
      return;
    }
    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && !event.altKey && phaseRef.current.kind !== 'validating' && view === 'folded') {
      const key = event.key.toLocaleLowerCase('en-US');
      if (key === 'd' && !event.shiftKey) {
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        if (!duplicateSelection()) return;
      }
      else if (key === 'z' && event.shiftKey) redo();
      else if (key === 'z') undo();
      else if (key === 'y') redo();
      else return;
      event.preventDefault();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.altKey && !commandKey) {
      deleteSelection();
      event.preventDefault();
      return;
    }
    if (commandKey || event.altKey || phaseRef.current.kind === 'validating') return;
    const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;
    if (arrowKeys.includes(event.key as typeof arrowKeys[number]) && tool === 'select' && view === 'folded' && selectedIdRef.current && !drag.current && !transformDrag.current) {
      const delta = screenPixelNudge(event.key as typeof arrowKeys[number], event.shiftKey ? 10 : 1, viewportRef.current, size);
      confirmCommand({ type: 'update-cut', operationId: selectedIdRef.current, change: { type: 'translate', ...delta } }, '正在确认微移');
      event.preventDefault();
      return;
    }
    const next = toolForShortcut(event.key);
    if (next) {
      if (isParametricShape(next) && !allowedShapes.includes(next)) return;
      chooseTool(next);
      event.preventDefault();
    }
  }

  function handleKeyUp(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Shift') {
      updateLineSnap(false);
      updateTransformSnap(false);
    }
  }

  const status = phaseText(phase, tool);
  const interactionBusy = phase.kind === 'drawing' || phase.kind === 'validating' || dragPreview !== null;
  const editDisabled = view === 'unfolded' || interactionBusy;
  const freehandEnabled = confirmedWork.editorProfileSnapshot.allowedTools.freehand.enabled;
  const artworkStyle = {
    left: metrics.origin.x,
    top: metrics.origin.y,
    width: metrics.base,
    height: metrics.base,
    transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})`,
  };

  return <section className="m15b-editor" data-operation-count={confirmedWork.operations.length} data-selected-id={selectedId ?? ''} onKeyDown={event => {
    if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'd') return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (duplicateSelection()) event.preventDefault();
  }}>
    <div className="m15b-editor-main" inert={clearDialogOpen ? true : undefined} aria-hidden={clearDialogOpen ? true : undefined}>
    {helpOpen ? <aside className="m16m-help" aria-labelledby="m16m-help-title">
      <div className="m16m-help-header">
        <h2 id="m16m-help-title">开始剪纸</h2>
        <button ref={helpCloseRef} type="button" onClick={closeHelp} aria-label="关闭使用帮助">关闭</button>
      </div>
      <ol>
        <li>选择剪除笔刷或图形，在纸上拖动剪除。</li>
        <li>用“选择”移动或复制切口；参数图形还可缩放、旋转。</li>
        <li>切换“展开视图”查看对称效果。</li>
        <li>完成后保存作品，也可在作品页面导出。</li>
      </ol>
    </aside> : null}
    <div className="m15b-toolbar" role="toolbar" aria-label="编辑工具">
      <button ref={helpButtonRef} type="button" disabled={phase.kind === 'validating'} aria-expanded={helpOpen} onClick={() => setHelpOpen(true)}>使用帮助</button>
      {visibleTools.map(item => <button key={item.id} type="button" aria-pressed={tool === item.id} title={`${toolDescription(item.id)} 画布快捷键：${item.shortcut}`} disabled={phase.kind === 'validating' || (item.id === 'line' && !freehandEnabled)} onClick={() => chooseTool(item.id)}>
        {item.label}<kbd>{item.shortcut}</kbd>
      </button>)}
      <span className="m15b-toolbar-divider" aria-hidden="true" />
      <button type="button" disabled={editDisabled || !canUndo} onClick={undo}>撤销</button>
      <button type="button" disabled={editDisabled || !canRedo} onClick={redo}>重做</button>
      <button type="button" disabled={editDisabled || tool !== 'select' || !selectedId} onClick={duplicateSelection}>复制</button>
      <button type="button" disabled={editDisabled || !selectedId} onClick={deleteSelection}>删除</button>
      <button ref={clearButtonRef} type="button" disabled={editDisabled || confirmedWork.operations.length === 0} onClick={() => setClearDialogOpen(true)}>清空</button>
      <span className="m15b-toolbar-divider" aria-hidden="true" />
      <button type="button" aria-pressed={view === 'folded'} disabled={phase.kind === 'validating'} onClick={() => chooseView('folded')}>折叠视图</button>
      <button type="button" aria-pressed={view === 'unfolded'} disabled={phase.kind === 'validating'} onClick={() => chooseView('unfolded')}>展开视图</button>
    </div>
    <p className="m16m-tool-hint" aria-live="polite">{toolLabel(tool)}：{toolDescription(tool)} 画布快捷键：{EDITOR_TOOLS.find(item => item.id === tool)?.shortcut}。</p>
    <div className="m15b-brush-width">
      <label htmlFor="m15b-brush-width-range">笔刷粗细</label>
      <input
        id="m15b-brush-width-range"
        type="range"
        min={FREEHAND_GEOMETRY_LIMITS_V2.brushMinWidth}
        max={FREEHAND_GEOMETRY_LIMITS_V2.brushMaxWidth}
        step={BRUSH_WIDTH_STEP}
        value={brushWidth}
        disabled={phase.kind === 'drawing' || phase.kind === 'validating'}
        onChange={event => setBrushWidth(brushWidthFromSlider(event.target.valueAsNumber))}
      />
      <output htmlFor="m15b-brush-width-range">{`${brushWidth}（${Math.round(brushWidth * 1000) / 10}%）`}</output>
    </div>
    <div
      ref={canvasRef}
      className="m15b-canvas"
      role="application"
      tabIndex={0}
      aria-label={`剪纸画布；当前工具：${toolLabel(tool)}；${chosenCut ? `已选择切口 ${chosenCut.order + 1}` : '未选择切口'}；状态：${status}`}
      aria-describedby="m15b-status m15b-selection-status"
      data-tool={tool}
      data-phase={phase.kind}
      data-view={view}
      data-zoom={viewport.zoom.toFixed(3)}
      style={{ touchAction: (tool === 'freehand' || tool === 'brush' || tool === 'line' || isParametricShape(tool)) && view === 'folded' ? 'none' : 'pan-y' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={event => handleCancellation(event.pointerId)}
      onLostPointerCapture={event => handleCancellation(event.pointerId)}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {renderResult.ok
        ? <div className="m15b-artwork" style={artworkStyle} aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderResult.value.svg }} />
        : <p className="m15b-render-error" role="alert">作品预览失败：{renderResult.error.message}</p>}
      {tool === 'brush' || tool === 'line'
        ? <BrushOverlay points={visiblePoints} brushWidth={brushWidth} size={size} viewport={viewport} />
        : <FreehandOverlay points={visiblePoints} size={size} viewport={viewport} phase={phase} />}
      <ParametricOverlay drag={parametricPreview} size={size} viewport={viewport} />
      <SelectionOverlay
        cut={chosenCut}
        cuts={cuts}
        interactive={tool === 'select' && view === 'folded' && phase.kind !== 'validating'}
        dx={previewDelta.dx}
        dy={previewDelta.dy}
        transformPreview={transformPreview}
        size={size}
        viewport={viewport}
      />
    </div>
    {tool === 'select' && view === 'folded' && chosenCut?.operation.kind === 'parametric' && propertyDraft ? <form
      className="m16k-properties"
      aria-label="选中图形属性"
      onSubmit={event => { event.preventDefault(); applyPropertyDraft(); }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || phase.kind === 'validating') return;
        restorePropertyDraft();
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <strong className="m16k-properties-title">精确属性</strong>
      {([
        ['centerX', '中心 X', '%'], ['centerY', '中心 Y', '%'], ['width', '宽度', '%'],
        ['height', '高度', '%'], ['angleDeg', '旋转角度', '°'],
      ] as const).map(([name, label, unit]) => <label key={name} className="m16k-property-field">
        <span>{label}</span>
        <span className="m16k-property-control">
          <input
            name={name}
            type="number"
            step="any"
            inputMode="decimal"
            value={propertyDraft[name]}
            disabled={phase.kind === 'validating'}
            aria-label={label}
            onChange={event => setPropertyDraft(current => current ? { ...current, [name]: event.target.value } : current)}
          />
          <span aria-hidden="true">{unit}</span>
        </span>
      </label>)}
      <div className="m16k-property-actions">
        <button type="submit" disabled={phase.kind === 'validating'}>应用</button>
        <button type="button" disabled={phase.kind === 'validating'} onClick={() => restorePropertyDraft()}>取消</button>
      </div>
    </form> : null}
    <button className="m15b-select-next" type="button" disabled={tool !== 'select' || editDisabled || cuts.length === 0} onClick={selectNextCut}>选择下一个切口</button>
    <p id="m15b-status" className={`m15b-status m15b-status-${phase.kind}`} role={phase.kind === 'error' ? 'alert' : 'status'}>{status}</p>
    <p id="m15b-selection-status" className="m15b-selection-status">{chosenCut ? `已选择：切口 ${chosenCut.order + 1}` : '未选择切口'}</p>
    {view === 'unfolded' ? <p className="m15b-disabled-reason">展开视图仅供查看；切回折叠视图后可绘制。</p> : null}
    </div>
    {clearDialogOpen ? <div className="m15b-dialog-backdrop">
      <div ref={clearDialogRef} className="m15b-dialog" role="alertdialog" aria-modal="true" aria-labelledby="m15b-clear-title" aria-describedby="m15b-clear-description" onKeyDown={handleClearDialogKeyDown}>
        <h2 id="m15b-clear-title">清空全部切口？</h2>
        <p id="m15b-clear-description">此操作会删除当前作品中的全部切口，可通过撤销恢复。</p>
        <div className="m15b-dialog-actions">
          <button ref={clearConfirmRef} type="button" onClick={confirmClear}>确认清空</button>
          <button type="button" onClick={closeClearDialog}>取消</button>
        </div>
      </div>
    </div> : null}
  </section>;
}
