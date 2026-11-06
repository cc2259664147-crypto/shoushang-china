import type { ParametricShape } from './parametric';

export type EditorTool = 'select' | 'freehand' | 'brush' | 'line' | ParametricShape | 'pan';

export interface EditorToolDefinition {
  readonly id: EditorTool;
  readonly label: string;
  readonly shortcut: string;
}

export const EDITOR_TOOLS: readonly EditorToolDefinition[] = [
  { id: 'select', label: '选择', shortcut: 'V' },
  { id: 'freehand', label: '自由剪刀', shortcut: 'F' },
  { id: 'brush', label: '剪除笔刷', shortcut: 'B' },
  { id: 'line', label: '直线', shortcut: 'L' },
  { id: 'circle', label: '圆形', shortcut: 'C' },
  { id: 'triangle', label: '三角形', shortcut: 'T' },
  { id: 'teardrop', label: '水滴形', shortcut: 'D' },
  { id: 'ellipse', label: '椭圆', shortcut: 'E' },
  { id: 'rectangle', label: '矩形', shortcut: 'R' },
  { id: 'star', label: '五角星', shortcut: 'S' },
  { id: 'petal', label: '花瓣', shortcut: 'P' },
  { id: 'pan', label: '平移', shortcut: 'H' },
];

export function toolLabel(tool: EditorTool): string {
  return EDITOR_TOOLS.find(item => item.id === tool)?.label ?? tool;
}

export function toolForShortcut(key: string): EditorTool | null {
  const normalized = key.toLocaleUpperCase('en-US');
  return EDITOR_TOOLS.find(item => item.shortcut === normalized)?.id ?? null;
}

/** Short descriptions reflect the actions supported by the current editor. */
export function toolDescription(tool: EditorTool): string {
  switch (tool) {
    case 'select': return '点击切口选中；拖动可移动，参数图形可缩放和旋转，也可复制。';
    case 'freehand': return '拖动绘制闭合轮廓，松开后剪除内部。';
    case 'brush': return '在纸上拖动，沿轨迹剪除。';
    case 'line': return '拖动剪出直线；按住 Shift 可吸附方向。';
    case 'pan': return '拖动画布以平移视图。';
    default: return '在纸上拖动，确定图形的位置和大小。';
  }
}
