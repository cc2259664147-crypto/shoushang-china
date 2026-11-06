import {
  BrushCandidateV2Schema,
  FreehandCandidateV2Schema,
  WorkV2Schema,
  type CoreError,
  type BrushCandidateV2,
  type BrushCutV2,
  type FreehandCandidateV2,
  type FreehandCutV2,
  type ParametricCutV2,
  type Result,
  type WorkV2,
} from '@shoushang/contracts';
import {
  apply,
  baseDomain,
  conservativeLocalContour,
  convex,
  symmetry,
  type AffineTransform,
  type CutGeometry,
  type LocalShape,
  type Point,
} from './geometry';

export const FREEHAND_GEOMETRY_LIMITS_V2 = Object.freeze({
  rawMaxPoints: 4096,
  savedMinPoints: 3,
  savedMaxPoints: 512,
  totalMaxPoints: 20_000,
  dedupeDistance: 0.0005,
  rdpTolerance: 0.0015,
  quantizationDigits: 6,
  coordinateQuantum: 0.000001,
  boundaryEpsilon: 0.0000001,
  intersectionEpsilon: 0.0000001,
  minArea: 0.00001,
  minPerimeter: 0.01,
  brushMinWidth: 0.005,
  brushMaxWidth: 0.12,
});

export interface PaperStrokeV2 {
  kind: 'paper-stroke';
  centerline: Point[];
  width: number;
  lineCap: 'round';
  lineJoin: 'round';
  conservativeBounds: { minX: number; minY: number; maxX: number; maxY: number };
}
export type LocalShapeV2 = LocalShape | { kind: 'paper-loop'; vertices: Point[] } | PaperStrokeV2;
export interface CutGeometryV2 extends Omit<CutGeometry, 'localShape'> {
  kind: 'parametric' | 'freehand' | 'brush';
  localShape: LocalShapeV2;
}
export interface WorkGeometryV2 {
  geometryVersion: 2;
  unit: 'paper-side';
  overlap: 'union';
  cuts: CutGeometryV2[];
  symmetryTransforms: AffineTransform[];
  baseDomain: Point[];
}

type Problem = { message: string; path: string };

function failed<T>(message: string, path: string, code: CoreError['code']): Result<T, CoreError> {
  return { ok: false, error: { code, message, requestId: 'papercut-core-v2', fieldErrors: [{ path, message }] } };
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input;
  for (const key of path) {
    if (Array.isArray(value) && typeof key === 'number') value = value[key];
    else if (typeof value === 'object' && value !== null && typeof key === 'string') value = (value as Record<string, unknown>)[key];
    else return undefined;
  }
  return value;
}

function isUnknownV2Version(input: unknown, path: readonly PropertyKey[]): boolean {
  const value = valueAt(input, path);
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return false;
  const field = String(path.at(-1));
  const inTemplate = path.includes('templateSnapshot');
  const expected = inTemplate && (field === 'geometryVersion' || field === 'rendererVersion') ? 1 : 2;
  return ['schemaVersion', 'profileSchemaVersion', 'geometryVersion', 'rendererVersion', 'parameterVersion'].includes(field) && value !== expected;
}

function schemaFailure<T>(input: unknown, issues: readonly { path: PropertyKey[]; message: string; code: string }[], subject: string): Result<T, CoreError> {
  const unsupported = issues.some(issue => issue.code === 'invalid_value' && isUnknownV2Version(input, issue.path));
  const message = unsupported ? `${subject}包含未知版本` : `${subject}结构或参数非法`;
  return {
    ok: false,
    error: {
      code: unsupported ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT',
      message,
      requestId: 'papercut-core-v2',
      fieldErrors: issues.map(issue => ({ path: issue.path.join('.') || 'work', message: issue.message })),
    },
  };
}

const squaredDistance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const equalPoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function insideV2(polygon: readonly Point[], point: Point): boolean {
  const signedArea = polygon.reduce((sum, vertex, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return sum + vertex.x * next.y - vertex.y * next.x;
  }, 0);
  const sign = Math.sign(signedArea), eps = FREEHAND_GEOMETRY_LIMITS_V2.boundaryEpsilon;
  return polygon.every((start, index) => {
    const end = polygon[(index + 1) % polygon.length]!;
    return cross(start, end, point) * sign >= -eps * Math.hypot(end.x - start.x, end.y - start.y);
  });
}

function polygonArea(points: readonly Point[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - point.y * next.x;
  }, 0)) / 2;
}

function perimeter(points: readonly Point[]): number {
  return points.reduce((sum, point, index) => sum + Math.sqrt(squaredDistance(point, points[(index + 1) % points.length]!)), 0);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const eps = FREEHAND_GEOMETRY_LIMITS_V2.intersectionEpsilon;
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  const tolerance = (p: Point, q: Point) => eps * Math.hypot(q.x - p.x, q.y - p.y);
  const on = (p: Point, q: Point, r: Point) => Math.abs(cross(p, q, r)) <= tolerance(p, q)
    && r.x >= Math.min(p.x, q.x) - eps && r.x <= Math.max(p.x, q.x) + eps
    && r.y >= Math.min(p.y, q.y) - eps && r.y <= Math.max(p.y, q.y) + eps;
  if (on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) return true;
  const abTolerance = tolerance(a, b), cdTolerance = tolerance(c, d);
  return ((abC > abTolerance && abD < -abTolerance) || (abD > abTolerance && abC < -abTolerance))
    && ((cdA > cdTolerance && cdB < -cdTolerance) || (cdB > cdTolerance && cdA < -cdTolerance));
}

function hasNonAdjacentIntersection(points: readonly Point[]): boolean {
  const gridSize = 64;
  const buckets = new Map<number, number[]>();
  const clampCell = (value: number) => Math.max(0, Math.min(gridSize - 1, Math.floor(value * gridSize)));
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const minX = clampCell(Math.min(point.x, next.x));
    const maxX = clampCell(Math.max(point.x, next.x));
    const minY = clampCell(Math.min(point.y, next.y));
    const maxY = clampCell(Math.max(point.y, next.y));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = y * gridSize + x;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(index); else buckets.set(key, [index]);
    }
  });
  const compared = new Set<string>();
  for (const bucket of buckets.values()) for (let a = 0; a < bucket.length; a++) for (let b = a + 1; b < bucket.length; b++) {
    const first = bucket[a]!, second = bucket[b]!;
    const distance = Math.abs(first - second);
    if (distance === 1 || distance === points.length - 1) continue;
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    if (compared.has(key)) continue;
    compared.add(key);
    if (segmentsIntersect(points[first]!, points[(first + 1) % points.length]!, points[second]!, points[(second + 1) % points.length]!)) return true;
  }
  return false;
}

function validateClosedPath(work: WorkV2, points: readonly Point[], path: string, saved: boolean): Problem | undefined {
  const limits = FREEHAND_GEOMETRY_LIMITS_V2;
  if (points.length < limits.savedMinPoints) return { message: '闭合路径有效点少于3个', path };
  if (saved && (points.length > limits.savedMaxPoints || points.length > work.editorProfileSnapshot.allowedTools.freehand.maxPoints)) {
    return { message: '单条自由路径点数超限', path };
  }
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return { message: '路径坐标必须为有限数', path };
  if (points.some(point => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return { message: '路径坐标超出单位纸面', path };
  const edgeEpsilonSquared = limits.intersectionEpsilon ** 2;
  if (points.some((point, index) => squaredDistance(point, points[(index + 1) % points.length]!) <= edgeEpsilonSquared)) {
    return { message: '闭合路径包含零长边', path };
  }
  if (points.some((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const overlapDirection = (previous.x - point.x) * (next.x - point.x) + (previous.y - point.y) * (next.y - point.y);
    const previousLength = Math.hypot(point.x - previous.x, point.y - previous.y);
    return Math.abs(cross(previous, point, next)) <= limits.intersectionEpsilon * previousLength
      && overlapDirection > limits.intersectionEpsilon ** 2;
  })) return { message: '闭合路径包含相邻共线重叠', path };
  const seen = new Map<string, number>();
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!, key = `${point.x}:${point.y}`;
    const previous = seen.get(key);
    if (previous !== undefined && Math.abs(previous - index) > 1) return { message: '闭合路径包含重复的非相邻点', path };
    seen.set(key, index);
  }
  if (hasNonAdjacentIntersection(points)) return { message: '闭合路径存在自交、非相邻接触或共线重叠', path };
  const minimumArea = Math.max(limits.minArea, work.editorProfileSnapshot.allowedTools.freehand.minArea);
  if (polygonArea(points) < minimumArea) return { message: '闭合路径面积不足或近共线', path };
  const minimumPerimeter = Math.max(limits.minPerimeter, work.editorProfileSnapshot.allowedTools.freehand.minPerimeter);
  if (perimeter(points) < minimumPerimeter) return { message: '闭合路径周长不足', path };
  const template = work.templateSnapshot;
  const domain = baseDomain(template);
  if (points.some(point => !insideV2(template.geometry.allowedRegion, point))) return { message: '闭合路径超出允许区域', path };
  if (points.some(point => !insideV2(domain, point))) return { message: '闭合路径超出基础折叠域', path };
  const gap = template.rules.minEdgeGap, eps = limits.boundaryEpsilon;
  if (symmetry(template).some(transform => points.some(point => {
    const transformed = apply(transform, point);
    return transformed.x < gap - eps || transformed.x > 1 - gap + eps || transformed.y < gap - eps || transformed.y > 1 - gap + eps;
  }))) return { message: '闭合路径到真实纸边的间距不足', path };
  return undefined;
}

function strokeInsideConvex(polygon: readonly Point[], points: readonly Point[], radius: number): boolean {
  const signedArea = polygon.reduce((sum, vertex, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return sum + vertex.x * next.y - vertex.y * next.x;
  }, 0);
  const sign = Math.sign(signedArea);
  return polygon.every((start, index) => {
    const end = polygon[(index + 1) % polygon.length]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    return length > 0 && points.every(point => cross(start, end, point) * sign / length >= radius - FREEHAND_GEOMETRY_LIMITS_V2.boundaryEpsilon);
  });
}

function validateBrushPath(work: WorkV2, points: readonly Point[], width: number, path: string, saved: boolean): Problem | undefined {
  if (points.length < 1) return { message: '笔刷轨迹至少需要1个点', path };
  if (saved && (points.length > FREEHAND_GEOMETRY_LIMITS_V2.savedMaxPoints || points.length > work.editorProfileSnapshot.allowedTools.freehand.maxPoints)) {
    return { message: '单条笔刷轨迹点数超限', path };
  }
  if (!Number.isFinite(width) || width < FREEHAND_GEOMETRY_LIMITS_V2.brushMinWidth || width > FREEHAND_GEOMETRY_LIMITS_V2.brushMaxWidth) {
    return { message: '笔刷宽度必须在0.005–0.12之间', path: path.replace(/\.points$/u, '.width') };
  }
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return { message: '笔刷坐标必须为有限数', path };
  const radius = width / 2;
  const template = work.templateSnapshot;
  if (!strokeInsideConvex(template.geometry.allowedRegion, points, radius)) return { message: '笔刷扫掠区域超出允许区域', path };
  if (!strokeInsideConvex(baseDomain(template), points, radius)) return { message: '笔刷扫掠区域超出基础折叠域', path };
  const gap = template.rules.minEdgeGap, eps = FREEHAND_GEOMETRY_LIMITS_V2.boundaryEpsilon;
  if (symmetry(template).some(transform => points.some(point => {
    const transformed = apply(transform, point);
    return transformed.x - radius < gap - eps || transformed.x + radius > 1 - gap + eps
      || transformed.y - radius < gap - eps || transformed.y + radius > 1 - gap + eps;
  }))) return { message: '笔刷扫掠区域到真实纸边的间距不足', path };
  return undefined;
}

function validateTemplate(work: WorkV2): Problem | undefined {
  const template = work.templateSnapshot;
  if (template.geometry.basePaper.kind !== 'square') return { message: 'geometryVersion=2当前仅支持单位方纸', path: 'templateSnapshot.geometry.basePaper' };
  const symmetryRule = template.geometry.symmetry;
  if (!(symmetryRule.kind === 'reflection' && symmetryRule.axis === 'vertical'
    || symmetryRule.kind === 'radial' && symmetryRule.sectors === 4 && !symmetryRule.mirror)) {
    return { message: '当前仅支持 vertical 镜像或 radial/4/mirror=false', path: 'templateSnapshot.geometry.symmetry' };
  }
  if (!convex(template.geometry.allowedRegion)) return { message: '允许区域必须是非退化凸多边形', path: 'templateSnapshot.geometry.allowedRegion' };
  return undefined;
}

function parametricLocalShape(operation: ParametricCutV2): LocalShape {
  const width = operation.width, height = operation.height;
  if (operation.shape === 'circle' || operation.shape === 'ellipse') return { kind: 'ellipse', radiusX: width / 2, radiusY: height / 2 };
  if (operation.shape === 'triangle') return { kind: 'polygon', vertices: [{ x: 0, y: -height / 2 }, { x: -width / 2, y: height / 2 }, { x: width / 2, y: height / 2 }] };
  if (operation.shape === 'rectangle') return { kind: 'polygon', vertices: [
    { x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 },
  ] };
  if (operation.shape === 'star') {
    const inner = (3 - Math.sqrt(5)) / 2;
    return { kind: 'polygon', vertices: Array.from({ length: 10 }, (_value, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      const radius = index % 2 === 0 ? 1 : inner;
      return { x: width / 2 * radius * Math.cos(angle), y: height / 2 * radius * Math.sin(angle) };
    }) };
  }
  if (operation.shape === 'petal') return { kind: 'cubic-loop', curves: [
    [{ x: 0, y: -height / 2 }, { x: -width / 2, y: -height / 6 }, { x: -width / 2, y: height / 6 }, { x: 0, y: height / 2 }],
    [{ x: 0, y: height / 2 }, { x: width / 2, y: height / 6 }, { x: width / 2, y: -height / 6 }, { x: 0, y: -height / 2 }],
  ] };
  return { kind: 'cubic-loop', curves: [
    [{ x: 0, y: -height / 2 }, { x: -2 * width / 3, y: 0 }, { x: -2 * width / 3, y: height / 2 }, { x: 0, y: height / 2 }],
    [{ x: 0, y: height / 2 }, { x: 2 * width / 3, y: height / 2 }, { x: 2 * width / 3, y: 0 }, { x: 0, y: -height / 2 }],
  ] };
}

function createParametricGeometry(operation: ParametricCutV2): CutGeometryV2 | undefined {
  const localShape = parametricLocalShape(operation);
  const angle = operation.angleDeg * Math.PI / 180;
  const placement = { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: operation.center.x, f: operation.center.y };
  const localContour = conservativeLocalContour(localShape);
  if (!localContour) return undefined;
  return {
    kind: 'parametric', operationId: operation.id, localShape, placement,
    conservativeContour: localContour.map(point => apply(placement, point)),
  };
}

function parametricGeometry(work: WorkV2, operation: ParametricCutV2, path: string): Result<CutGeometryV2, CoreError> {
  const limit = work.templateSnapshot.allowedCuts.find(candidate => candidate.shape === operation.shape);
  if (!limit) return failed('来源模板不允许此形状', `${path}.shape`, 'GEOMETRY_INVALID');
  if (operation.width < limit.minWidth || operation.width > limit.maxWidth) return failed('宽度超出模板限制', `${path}.width`, 'GEOMETRY_INVALID');
  if (operation.height < limit.minHeight || operation.height > limit.maxHeight) return failed('高度超出模板限制', `${path}.height`, 'GEOMETRY_INVALID');
  const geometry = createParametricGeometry(operation);
  if (!geometry) return failed('曲线保守包络未收敛', path, 'GEOMETRY_INVALID');
  const template = work.templateSnapshot;
  if (geometry.conservativeContour.some(point => !insideV2(template.geometry.allowedRegion, point))) return failed('完整轮廓超出允许区域', `${path}.center`, 'GEOMETRY_INVALID');
  if (geometry.conservativeContour.some(point => !insideV2(baseDomain(template), point))) return failed('完整轮廓超出基础折叠域', `${path}.center`, 'GEOMETRY_INVALID');
  const gap = template.rules.minEdgeGap, eps = FREEHAND_GEOMETRY_LIMITS_V2.boundaryEpsilon;
  if (symmetry(template).some(transform => geometry.conservativeContour.some(point => {
    const transformed = apply(transform, point);
    return transformed.x < gap - eps || transformed.x > 1 - gap + eps || transformed.y < gap - eps || transformed.y > 1 - gap + eps;
  }))) return failed('切口到真实纸边间距不足', `${path}.center`, 'GEOMETRY_INVALID');
  return { ok: true, value: geometry };
}

export function validateWorkV2(input: unknown): Result<WorkV2, CoreError> {
  const parsed = WorkV2Schema.safeParse(input);
  if (!parsed.success) return schemaFailure(input, parsed.error.issues, '作品');
  const work = parsed.data;
  const templateProblem = validateTemplate(work);
  if (templateProblem) return failed(
    templateProblem.message,
    templateProblem.path,
    templateProblem.path.endsWith('allowedRegion') ? 'GEOMETRY_INVALID' : 'UNSUPPORTED_VERSION',
  );
  let totalPoints = 0;
  for (const [index, operation] of work.operations.entries()) {
    const path = `operations.${index}`;
    if (operation.kind === 'parametric') {
      const result = parametricGeometry(work, operation, path);
      if (!result.ok) return result;
    } else if (operation.kind === 'freehand') {
      totalPoints += operation.points.length;
      const problem = validateClosedPath(work, operation.points, `${path}.points`, true);
      if (problem) return failed(problem.message, problem.path, 'GEOMETRY_INVALID');
    } else {
      totalPoints += operation.points.length;
      const problem = validateBrushPath(work, operation.points, operation.width, `${path}.points`, true);
      if (problem) return failed(problem.message, problem.path, 'GEOMETRY_INVALID');
    }
  }
  const totalLimit = Math.min(FREEHAND_GEOMETRY_LIMITS_V2.totalMaxPoints, work.editorProfileSnapshot.maxTotalFreehandPoints);
  if (totalPoints > totalLimit) return failed('作品自由路径总点数超限', 'operations', 'GEOMETRY_INVALID');
  return { ok: true, value: work };
}

function dedupeNear(points: readonly Point[], preserveLast = false): Point[] {
  const result: Point[] = [];
  const threshold = FREEHAND_GEOMETRY_LIMITS_V2.dedupeDistance ** 2;
  for (const point of points) if (!result.length || squaredDistance(result[result.length - 1]!, point) >= threshold) result.push({ x: point.x, y: point.y });
  const last = points.at(-1);
  if (preserveLast && last && result.length && !equalPoint(result[result.length - 1]!, last)) {
    if (result.length === 1 || squaredDistance(result[result.length - 1]!, last) < threshold) result[result.length - 1] = { ...last };
    else result.push({ ...last });
  }
  return result;
}

function pointSegmentDistanceSquared(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return squaredDistance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return squaredDistance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

export function simplifyRdpV2(points: readonly Point[]): Point[] {
  if (points.length <= 2) return points.map(point => ({ ...point }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true; keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  const toleranceSquared = FREEHAND_GEOMETRY_LIMITS_V2.rdpTolerance ** 2;
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let farthest = -1, maximum = -1;
    for (let index = start + 1; index < end; index++) {
      const distance = pointSegmentDistanceSquared(points[index]!, points[start]!, points[end]!);
      if (distance > maximum) { maximum = distance; farthest = index; }
    }
    if (farthest >= 0 && maximum > toleranceSquared) {
      keep[farthest] = true;
      stack.push([farthest, end], [start, farthest]);
    }
  }
  return points.filter((_point, index) => keep[index]).map(point => ({ ...point }));
}

export function quantizePointV2(point: Point): Point {
  const scale = 10 ** FREEHAND_GEOMETRY_LIMITS_V2.quantizationDigits;
  const quantize = (value: number) => {
    const rounded = Math.round(value * scale) / scale;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return { x: quantize(point.x), y: quantize(point.y) };
}

function normalizeFreehand(work: WorkV2, input: unknown): Result<FreehandCutV2, CoreError> {
  const parsed = FreehandCandidateV2Schema.safeParse(input);
  if (!parsed.success) return schemaFailure(input, parsed.error.issues, '自由路径候选');
  const candidate = parsed.data;
  if (candidate.rawPoints.length > FREEHAND_GEOMETRY_LIMITS_V2.rawMaxPoints) return failed('原始轨迹点数超限', 'candidate.rawPoints', 'INVALID_INPUT');
  if (candidate.order !== work.operations.length) return failed('新操作顺序必须紧接当前末尾', 'candidate.order', 'INVALID_INPUT');
  if (work.operations.some(operation => operation.id === candidate.id)) return failed('操作ID不可重复', 'candidate.id', 'INVALID_INPUT');
  if (!work.editorProfileSnapshot.allowedTools.freehand.enabled) return failed('当前配置未启用自由路径', 'editorProfileSnapshot.allowedTools.freehand.enabled', 'GEOMETRY_INVALID');
  const deduped = dedupeNear(candidate.rawPoints);
  const rawProblem = validateClosedPath(work, deduped, 'candidate.rawPoints', false);
  if (rawProblem) return failed(rawProblem.message, rawProblem.path, 'GEOMETRY_INVALID');
  const simplified = simplifyRdpV2(deduped);
  const quantized: Point[] = [];
  for (const point of simplified.map(quantizePointV2)) if (!quantized.length || !equalPoint(quantized[quantized.length - 1]!, point)) quantized.push(point);
  if (quantized.length > 1 && equalPoint(quantized[0]!, quantized[quantized.length - 1]!)) quantized.pop();
  const normalizedProblem = validateClosedPath(work, quantized, 'candidate.rawPoints', true);
  if (normalizedProblem) return failed(normalizedProblem.message, normalizedProblem.path, 'GEOMETRY_INVALID');
  const existingPoints = work.operations.reduce((sum, operation) => sum + (operation.kind === 'freehand' || operation.kind === 'brush' ? operation.points.length : 0), 0);
  const totalLimit = Math.min(FREEHAND_GEOMETRY_LIMITS_V2.totalMaxPoints, work.editorProfileSnapshot.maxTotalFreehandPoints);
  if (existingPoints + quantized.length > totalLimit) return failed('作品自由路径总点数超限', 'operations', 'GEOMETRY_INVALID');
  if (work.operations.length + 1 > work.templateSnapshot.rules.maxOperations || work.operations.length + 1 > 100) {
    return failed('作品操作数超限', 'operations', 'GEOMETRY_INVALID');
  }
  return {
    ok: true,
    value: { kind: 'freehand', id: candidate.id, order: candidate.order, parameterVersion: 2, points: quantized, closed: true },
  };
}

export function prepareFreehandCutV2(workInput: unknown, candidate: FreehandCandidateV2): Result<FreehandCutV2, CoreError> {
  const work = validateWorkV2(workInput);
  return work.ok ? normalizeFreehand(work.value, candidate) : work;
}

function normalizeBrush(work: WorkV2, input: unknown): Result<BrushCutV2, CoreError> {
  const parsed = BrushCandidateV2Schema.safeParse(input);
  if (!parsed.success) return schemaFailure(input, parsed.error.issues, '笔刷候选');
  const candidate = parsed.data;
  if (candidate.order !== work.operations.length) return failed('新操作顺序必须紧接当前末尾', 'candidate.order', 'INVALID_INPUT');
  if (work.operations.some(operation => operation.id === candidate.id)) return failed('操作ID不可重复', 'candidate.id', 'INVALID_INPUT');
  if (!work.editorProfileSnapshot.allowedTools.freehand.enabled) return failed('当前配置未启用自由路径', 'editorProfileSnapshot.allowedTools.freehand.enabled', 'GEOMETRY_INVALID');
  const deduped = dedupeNear(candidate.rawPoints, true);
  const rawProblem = validateBrushPath(work, deduped, candidate.width, 'candidate.rawPoints', false);
  if (rawProblem) return failed(rawProblem.message, rawProblem.path, 'GEOMETRY_INVALID');
  const simplified = simplifyRdpV2(deduped);
  const quantized: Point[] = [];
  for (const point of simplified.map(quantizePointV2)) if (!quantized.length || !equalPoint(quantized[quantized.length - 1]!, point)) quantized.push(point);
  const normalizedProblem = validateBrushPath(work, quantized, candidate.width, 'candidate.rawPoints', true);
  if (normalizedProblem) return failed(normalizedProblem.message, normalizedProblem.path, 'GEOMETRY_INVALID');
  const existingPoints = work.operations.reduce((sum, operation) => sum + (operation.kind === 'freehand' || operation.kind === 'brush' ? operation.points.length : 0), 0);
  const totalLimit = Math.min(FREEHAND_GEOMETRY_LIMITS_V2.totalMaxPoints, work.editorProfileSnapshot.maxTotalFreehandPoints);
  if (existingPoints + quantized.length > totalLimit) return failed('作品自由路径总点数超限', 'operations', 'GEOMETRY_INVALID');
  if (work.operations.length + 1 > work.templateSnapshot.rules.maxOperations || work.operations.length + 1 > 100) return failed('作品操作数超限', 'operations', 'GEOMETRY_INVALID');
  return { ok: true, value: { kind: 'brush', id: candidate.id, order: candidate.order, parameterVersion: 2, points: quantized, width: candidate.width } };
}

export function prepareBrushCutV2(workInput: unknown, candidate: BrushCandidateV2): Result<BrushCutV2, CoreError> {
  const work = validateWorkV2(workInput);
  return work.ok ? normalizeBrush(work.value, candidate) : work;
}

export function getWorkGeometryV2(input: unknown): Result<WorkGeometryV2, CoreError> {
  const checked = validateWorkV2(input);
  if (!checked.ok) return checked;
  const work = checked.value, cuts: CutGeometryV2[] = [];
  for (const [index, operation] of work.operations.entries()) {
    if (operation.kind === 'parametric') {
      const result = parametricGeometry(work, operation, `operations.${index}`);
      if (!result.ok) return result;
      cuts.push(result.value);
    } else if (operation.kind === 'freehand') {
      const vertices = operation.points.map(point => ({ ...point }));
      cuts.push({
        kind: 'freehand', operationId: operation.id,
        localShape: { kind: 'paper-loop', vertices },
        placement: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        conservativeContour: vertices.map(point => ({ ...point })),
      });
    } else {
      const centerline = operation.points.map(point => ({ ...point }));
      const radius = operation.width / 2;
      const xs = centerline.map(point => point.x), ys = centerline.map(point => point.y);
      const scale = 10 ** FREEHAND_GEOMETRY_LIMITS_V2.quantizationDigits;
      const lower = (value: number) => Math.floor((value + Number.EPSILON) * scale) / scale;
      const upper = (value: number) => Math.ceil((value - Number.EPSILON) * scale) / scale;
      const bounds = {
        minX: lower(Math.min(...xs) - radius), minY: lower(Math.min(...ys) - radius),
        maxX: upper(Math.max(...xs) + radius), maxY: upper(Math.max(...ys) + radius),
      };
      cuts.push({
        kind: 'brush', operationId: operation.id,
        localShape: { kind: 'paper-stroke', centerline, width: operation.width, lineCap: 'round', lineJoin: 'round', conservativeBounds: bounds },
        placement: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        conservativeContour: [
          { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
        ],
      });
    }
  }
  const template = work.templateSnapshot;
  return {
    ok: true,
    value: {
      geometryVersion: 2, unit: 'paper-side', overlap: 'union', cuts,
      symmetryTransforms: symmetry(template).map(transform => ({ ...transform })),
      baseDomain: baseDomain(template).map(point => ({ ...point })),
    },
  };
}

export function validateCandidateForSession(work: WorkV2, candidate: unknown): Result<FreehandCutV2, CoreError> {
  return normalizeFreehand(work, candidate);
}

export function validateBrushCandidateForSession(work: WorkV2, candidate: unknown): Result<BrushCutV2, CoreError> {
  return normalizeBrush(work, candidate);
}

export function validateParametricForSession(work: WorkV2, operation: ParametricCutV2): Result<CutGeometryV2, CoreError> {
  return parametricGeometry(work, operation, `operations.${operation.order}`);
}
