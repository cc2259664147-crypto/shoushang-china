import type { ParametricCutV2 } from '@shoushang/contracts';
import { canvasMetrics, type CanvasSize, type Viewport } from './coordinates';

export interface ParametricPropertyDraft {
  readonly centerX: string;
  readonly centerY: string;
  readonly width: string;
  readonly height: string;
  readonly angleDeg: string;
}

export interface ParametricPropertyValue {
  readonly center: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly angleDeg: number;
}

export type PropertyParseResult =
  | { readonly ok: true; readonly value: ParametricPropertyValue }
  | { readonly ok: false; readonly message: string };

function displayNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function parametricPropertyDraft(operation: ParametricCutV2): ParametricPropertyDraft {
  return {
    centerX: displayNumber(operation.center.x * 100),
    centerY: displayNumber(operation.center.y * 100),
    width: displayNumber(operation.width * 100),
    height: displayNumber(operation.height * 100),
    angleDeg: displayNumber(operation.angleDeg),
  };
}

function parseFinite(value: string, label: string): number | string {
  if (value.trim() === '') return `请输入${label}`;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : `${label}必须是有限数字`;
}

export function parseParametricPropertyDraft(draft: ParametricPropertyDraft): PropertyParseResult {
  const centerX = parseFinite(draft.centerX, '中心 X');
  const centerY = parseFinite(draft.centerY, '中心 Y');
  const width = parseFinite(draft.width, '宽度');
  const height = parseFinite(draft.height, '高度');
  const angleDeg = parseFinite(draft.angleDeg, '旋转角度');
  if (typeof centerX === 'string') return { ok: false, message: centerX };
  if (typeof centerY === 'string') return { ok: false, message: centerY };
  if (typeof width === 'string') return { ok: false, message: width };
  if (typeof height === 'string') return { ok: false, message: height };
  if (typeof angleDeg === 'string') return { ok: false, message: angleDeg };
  if (centerX < 0 || centerX > 100) return { ok: false, message: '中心 X 必须在 0% 到 100% 之间' };
  if (centerY < 0 || centerY > 100) return { ok: false, message: '中心 Y 必须在 0% 到 100% 之间' };
  if (width <= 0 || width > 100) return { ok: false, message: '宽度必须大于 0% 且不超过 100%' };
  if (height <= 0 || height > 100) return { ok: false, message: '高度必须大于 0% 且不超过 100%' };
  return {
    ok: true,
    value: {
      center: { x: centerX / 100, y: centerY / 100 },
      width: width / 100,
      height: height / 100,
      angleDeg,
    },
  };
}

/** Converts an exact CSS-pixel keyboard nudge into paper coordinates at the current zoom. */
export function screenPixelNudge(
  direction: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  pixels: number,
  viewport: Viewport,
  size: CanvasSize,
): { readonly dx: number; readonly dy: number } {
  const paperDistance = pixels / (viewport.zoom * canvasMetrics(size).base);
  if (direction === 'ArrowLeft') return { dx: -paperDistance, dy: 0 };
  if (direction === 'ArrowRight') return { dx: paperDistance, dy: 0 };
  if (direction === 'ArrowUp') return { dx: 0, dy: -paperDistance };
  return { dx: 0, dy: paperDistance };
}
