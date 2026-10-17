import { WorkSchema, type CoreError, type Result, type Work } from '@shoushang/contracts';
import { failure, unknownVersion } from './errors';
import { apply, baseDomain, convex, cutGeometry, GEOMETRY_TOLERANCES, inside, symmetry, type WorkGeometry } from './geometry';

export type WorkValidator = (input: unknown) => Result<Work, CoreError>;

/**
 * One validation transaction only. Keys are built from schema-parsed values,
 * never object identity: mutable caller data must be checked again next dispatch.
 * Every Work still passes the full schema, counts, identity/order and size checks.
 */
export function createWorkValidator(): WorkValidator {
 const acceptedTemplates = new Map<string, Set<string>>();
 return (input: unknown): Result<Work, CoreError> => {
  const parsed = WorkSchema.safeParse(input);
  if (!parsed.success) {
   const issues = parsed.error.issues;
   const version = issues.some(i => i.code === 'invalid_value' && ['schemaVersion', 'geometryVersion', 'rendererVersion', 'parameterVersion'].includes(String(i.path.at(-1))) && unknownVersion(input, i.path));
   return { ok: false, error: { code: version ? 'UNSUPPORTED_VERSION' : 'INVALID_INPUT', message: version ? '作品包含未知算法或数据版本' : '作品结构或参数非法', requestId: 'papercut-core-v1', fieldErrors: issues.map(i => ({ path: i.path.join('.') || 'work', message: i.message })) } };
  }
  const w = parsed.data, t = w.templateSnapshot, s = t.geometry.symmetry;
  // Schema returns a stable field order. Full template values include every rule
  // and version; equal cut parameters under a different template are not trusted.
  const templateKey = JSON.stringify(t);
  let acceptedCuts = acceptedTemplates.get(templateKey);
  if (!acceptedCuts) {
   if (t.geometry.basePaper.kind !== 'square') return failure('geometryVersion=1 当前仅支持单位方纸', 'templateSnapshot.geometry.basePaper', 'UNSUPPORTED_VERSION');
   if (!(s.kind === 'reflection' && s.axis === 'vertical' || s.kind === 'radial' && s.sectors === 4 && !s.mirror)) return failure('当前仅支持 vertical 镜像或 radial/4/mirror=false', 'templateSnapshot.geometry.symmetry', 'UNSUPPORTED_VERSION');
   if (!convex(t.geometry.allowedRegion)) return failure('允许区域必须是无重复顶点、无交叉的非退化凸多边形', 'templateSnapshot.geometry.allowedRegion');
   acceptedCuts = new Set<string>();
   acceptedTemplates.set(templateKey, acceptedCuts);
  }
  if (w.operations.length > t.rules.maxOperations) return failure('超过模板操作数量上限', 'operations');
  const domain = baseDomain(t), transforms = symmetry(t);
  for (const [i, o] of w.operations.entries()) {
   const path = `operations.${i}`, limit = t.allowedCuts.find(l => l.shape === o.shape);
   if (!limit) return failure('模板不允许此形状', `${path}.shape`);
   if (o.width < limit.minWidth || o.width > limit.maxWidth) return failure('宽度超出模板限制', `${path}.width`);
   if (o.height < limit.minHeight || o.height > limit.maxHeight) return failure('高度超出模板限制', `${path}.height`);
   // IDs/order remain Work-level constraints; they do not change cut geometry.
   const cutKey = JSON.stringify([o.parameterVersion, o.shape, o.center.x, o.center.y, o.width, o.height, o.angleDeg]);
   if (acceptedCuts.has(cutKey)) continue;
   const g = cutGeometry(o);
   if (!g) return failure('曲线保守包络未收敛，拒绝此操作', path);
   if (g.conservativeContour.some(p => !inside(t.geometry.allowedRegion, p))) return failure('旋转后完整轮廓超出允许区域', `${path}.center`);
   if (g.conservativeContour.some(p => !inside(domain, p))) return failure('完整轮廓超出对称基础域（折叠边界）', `${path}.center`);
   const gap = t.rules.minEdgeGap, eps = GEOMETRY_TOLERANCES.boundary;
   if (transforms.some(m => g.conservativeContour.some(p => {
    const q = apply(m, p);
    return q.x < gap - eps || q.x > 1 - gap + eps || q.y < gap - eps || q.y > 1 - gap + eps;
   }))) return failure('切口到真实纸边间距不足', `${path}.center`);
   // Only successful geometry is reusable, with no field path or mutable output.
   acceptedCuts.add(cutKey);
  }
  return { ok: true, value: w };
 };
}

export function validateWork(input: unknown): Result<Work, CoreError> {
 return createWorkValidator()(input);
}

/** Runtime-checked pure geometry for M06; original curves and checking hulls stay distinct. */
export function getWorkGeometry(input: unknown): Result<WorkGeometry, CoreError> {
 const r = validateWork(input); if (!r.ok) return r;
 const t = r.value.templateSnapshot, cuts = [];
 for (const o of r.value.operations) { const g = cutGeometry(o); if (!g) return failure('曲线保守包络未收敛', 'operations'); cuts.push(g); }
 return { ok: true, value: { geometryVersion: 1, unit: 'paper-side', overlap: 'union', cuts, symmetryTransforms: symmetry(t), baseDomain: baseDomain(t) } };
}
