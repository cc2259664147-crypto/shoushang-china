import { z } from 'zod';

/** Public DTOs are strict allowlists: management-only fields must never cross this boundary. */
export const IdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const IsoTimeSchema = z.iso.datetime({ offset: true });
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Text = z.string().trim().min(1);
const HttpUrl = z.url({ protocol: /^https?$/ });
export const SourceSchema = z.strictObject({
  title: Text, author: Text, url: HttpUrl.optional(), accessedAt: IsoTimeSchema,
  citation: Text, note: Text,
});
export const LicenseSchema = z.strictObject({ name: Text, attribution: Text, url: HttpUrl.optional() });
export const MediaSchema = z.strictObject({
  id: IdSchema,
  // Same-origin root paths or HTTP(S); never script/data URLs or private proof references.
  url: z.union([HttpUrl, z.string().regex(/^\/(?!\/)[a-zA-Z0-9/_ .-]+$/)]),
  alt: Text, author: Text, license: LicenseSchema,
  /** Public provenance and editorial changes; optional for older stored fixtures. */
  source: Text.optional(), modification: Text.optional(),
  width: z.number().int().positive().max(6000), height: z.number().int().positive().max(6000),
  kind: z.enum(['illustration', 'photograph']),
});
export const CraftSchema = z.strictObject({
  id: IdSchema, name: Text, slug: z.string().regex(/^[a-z0-9-]+$/), description: Text,
  status: z.enum(['active', 'archived']), supportsExperience: z.boolean(),
});
export const CutShapeSchema = z.enum(['circle', 'triangle', 'teardrop']);
/** V2 extends the parameterized shape set without widening the frozen v1 contract. */
export const CutShapeV2Schema = z.enum(['circle', 'triangle', 'teardrop', 'ellipse', 'rectangle', 'star', 'petal']);
export const PointSchema = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const Size = z.number().positive().max(1);
const Angle = z.number().min(0).lt(360);
export const CutOperationSchema = z.strictObject({
  id: IdSchema, shape: CutShapeSchema, center: PointSchema,
  width: Size, height: Size, angleDeg: Angle,
  order: z.number().int().nonnegative(), parameterVersion: z.literal(1),
});
const CutLimitsSchema = z.strictObject({
  shape: CutShapeSchema, minWidth: Size, maxWidth: Size, minHeight: Size, maxHeight: Size,
}).refine(v => v.minWidth <= v.maxWidth && v.minHeight <= v.maxHeight, '尺寸下限不能大于上限');
export const TemplateVersionSchema = z.strictObject({
  id: IdSchema, craftId: IdSchema, version: z.number().int().positive(), name: Text,
  difficulty: z.enum(['beginner', 'advanced']), steps: z.array(Text).min(1),
  enabled: z.boolean(),
  geometry: z.strictObject({
    basePaper: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('square') }),
      z.strictObject({ kind: z.literal('circle') }),
    ]),
    symmetry: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('reflection'), axis: z.enum(['vertical', 'horizontal', 'both']) }),
      z.strictObject({ kind: z.literal('radial'), sectors: z.union([z.literal(4), z.literal(6), z.literal(8)]), mirror: z.boolean() }),
    ]),
    // Polygon vertices use the same normalized coordinate system as operations.
    allowedRegion: z.array(PointSchema).min(3),
  }),
  allowedCuts: z.array(CutLimitsSchema).min(1).refine(v => new Set(v.map(x => x.shape)).size === v.length, '剪切形状不可重复'),
  rules: z.strictObject({ minEdgeGap: z.number().min(0).max(1), maxOperations: z.number().int().min(1).max(100) }),
  recommendedColors: z.array(ColorSchema).min(1), license: LicenseSchema, digitalNotice: Text,
  // Immutable algorithm version and complete geometry keep old works reproducible.
  geometryVersion: z.literal(1), rendererVersion: z.literal(1),
});
const PaletteSchema = z.strictObject({ paper: ColorSchema, background: ColorSchema });
export const WorkSchema = z.strictObject({
  id: IdSchema, name: Text.max(30), craftId: IdSchema,
  templateSnapshot: TemplateVersionSchema,
  palette: PaletteSchema,
  operations: z.array(CutOperationSchema).max(100), status: z.enum(['draft', 'completed']),
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  createdAt: IsoTimeSchema, updatedAt: IsoTimeSchema,
}).superRefine((v, ctx) => {
  if (v.craftId !== v.templateSnapshot.craftId) ctx.addIssue({ code: 'custom', path: ['craftId'], message: '工艺必须与模板一致' });
  if (Date.parse(v.updatedAt) < Date.parse(v.createdAt)) ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: '更新时间不能早于创建时间' });
  if (new Set(v.operations.map(o => o.id)).size !== v.operations.length) ctx.addIssue({ code: 'custom', path: ['operations'], message: '操作ID不可重复' });
  if (v.operations.some((o, i) => o.order !== i)) ctx.addIssue({ code: 'custom', path: ['operations'], message: '顺序必须从0连续递增' });
});

/** Stable v1 names. Existing unversioned exports intentionally retain v1 semantics. */
export const CutOperationV1Schema = CutOperationSchema;
export const TemplateVersionV1Schema = TemplateVersionSchema;
export const WorkV1Schema = WorkSchema;

const CutLimitsV2Schema = z.strictObject({
  shape: CutShapeV2Schema, minWidth: Size, maxWidth: Size, minHeight: Size, maxHeight: Size,
}).refine(v => v.minWidth <= v.maxWidth && v.minHeight <= v.maxHeight, '尺寸下限不能大于上限');
/** A v2 work snapshots the same template fields, with the v2 parameterized shape vocabulary. */
export const TemplateSnapshotV2Schema = TemplateVersionV1Schema.extend({
  allowedCuts: z.array(CutLimitsV2Schema).min(1).refine(v => new Set(v.map(x => x.shape)).size === v.length, '剪切形状不可重复'),
});
/** Public template responses accept both frozen v1 templates and v2-capable additions. */
export const PublicTemplateSchema = z.union([TemplateVersionV1Schema, TemplateSnapshotV2Schema]);

const FiniteNumberSchema = z.number().finite();
const QuantizedCoordinateV2Schema = FiniteNumberSchema.min(0).max(1).refine(
  value => value === Math.round(value * 1_000_000) / 1_000_000,
  '坐标必须与六位小数量化值严格相等',
);
const Point01V2Schema = z.strictObject({ x: QuantizedCoordinateV2Schema, y: QuantizedCoordinateV2Schema });

/** Transient input point: finite, but deliberately not clamped to the paper domain. */
export const RawPointV2Schema = z.strictObject({ x: FiniteNumberSchema, y: FiniteNumberSchema });
export const FreehandCandidateV2Schema = z.strictObject({
  id: IdSchema,
  order: z.number().int().nonnegative(),
  rawPoints: z.array(RawPointV2Schema).min(3).max(4096),
});
const BrushWidthV2Schema = FiniteNumberSchema.min(0.005).max(0.12).refine(
  value => value === Math.round(value * 1_000_000) / 1_000_000,
  '笔刷宽度必须与六位小数量化值严格相等',
);
export const BrushCandidateV2Schema = z.strictObject({
  id: IdSchema,
  order: z.number().int().nonnegative(),
  rawPoints: z.array(RawPointV2Schema).min(1).max(4096),
  width: BrushWidthV2Schema,
});

export const ParametricCutV2Schema = z.strictObject({
  kind: z.literal('parametric'), id: IdSchema,
  order: z.number().int().nonnegative(), parameterVersion: z.literal(2),
  shape: CutShapeV2Schema, center: PointSchema,
  width: Size, height: Size, angleDeg: Angle,
});
export const FreehandCutV2Schema = z.strictObject({
  kind: z.literal('freehand'), id: IdSchema,
  order: z.number().int().nonnegative(), parameterVersion: z.literal(2),
  points: z.array(Point01V2Schema).min(3).max(512), closed: z.literal(true),
}).superRefine((value, ctx) => {
  const first = value.points[0];
  const last = value.points[value.points.length - 1];
  if (first && last && first.x === last.x && first.y === last.y) {
    ctx.addIssue({ code: 'custom', path: ['points', value.points.length - 1], message: '闭合路径不得重复保存起点' });
  }
});
export const BrushCutV2Schema = z.strictObject({
  kind: z.literal('brush'), id: IdSchema,
  order: z.number().int().nonnegative(), parameterVersion: z.literal(2),
  points: z.array(Point01V2Schema).min(1).max(512),
  width: BrushWidthV2Schema,
});
export const CutOperationV2Schema = z.discriminatedUnion('kind', [ParametricCutV2Schema, FreehandCutV2Schema, BrushCutV2Schema]);

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const EditorProfileV2Schema = z.strictObject({
  profileId: IdSchema, profileSchemaVersion: z.literal(2),
  profileVersion: z.number().int().positive(),
  sourceTemplate: z.strictObject({
    id: IdSchema, version: z.number().int().positive(), snapshotSha256: Sha256Schema,
  }),
  allowedTools: z.strictObject({
    parametric: z.array(CutShapeV2Schema).refine(
      tools => new Set(tools).size === tools.length,
      '参数化工具不可重复',
    ),
    freehand: z.strictObject({
      enabled: z.boolean(), minArea: FiniteNumberSchema.min(0.00001),
      minPerimeter: FiniteNumberSchema.min(0.01),
      maxPoints: z.number().int().min(3).max(512),
    }),
  }),
  maxTotalFreehandPoints: z.number().int().positive().max(20_000),
  geometryVersion: z.literal(2), rendererVersion: z.literal(2),
}).refine(
  profile => profile.maxTotalFreehandPoints >= profile.allowedTools.freehand.maxPoints,
  { path: ['maxTotalFreehandPoints'], message: '总点数上限不得小于单路径上限' },
);
export const EditorProfileLifecycleV2Schema = z.strictObject({
  newWorkEnabled: z.boolean(), historicalMode: z.enum(['editable', 'read-export-only']),
});
export const EditorProfileRegistryEntryV2Schema = z.strictObject({
  profile: EditorProfileV2Schema, lifecycle: EditorProfileLifecycleV2Schema,
});

export const WorkV2Schema = z.strictObject({
  id: IdSchema, name: Text.max(30), craftId: IdSchema,
  templateSnapshot: TemplateSnapshotV2Schema,
  editorProfileSnapshot: EditorProfileV2Schema,
  palette: PaletteSchema, operations: z.array(CutOperationV2Schema).max(100),
  status: z.enum(['draft', 'completed']), schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(), createdAt: IsoTimeSchema, updatedAt: IsoTimeSchema,
}).superRefine((value, ctx) => {
  if (value.craftId !== value.templateSnapshot.craftId) {
    ctx.addIssue({ code: 'custom', path: ['craftId'], message: '工艺必须与模板一致' });
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: '更新时间不能早于创建时间' });
  }
  if (new Set(value.operations.map(operation => operation.id)).size !== value.operations.length) {
    ctx.addIssue({ code: 'custom', path: ['operations'], message: '操作ID不可重复' });
  }
  if (value.operations.some((operation, index) => operation.order !== index)) {
    ctx.addIssue({ code: 'custom', path: ['operations'], message: '顺序必须从0连续递增' });
  }
  if (value.operations.length > value.templateSnapshot.rules.maxOperations) {
    ctx.addIssue({ code: 'custom', path: ['operations'], message: '操作数超过模板上限' });
  }
  const source = value.editorProfileSnapshot.sourceTemplate;
  if (source.id !== value.templateSnapshot.id || source.version !== value.templateSnapshot.version) {
    ctx.addIssue({ code: 'custom', path: ['editorProfileSnapshot', 'sourceTemplate'], message: '编辑器配置必须匹配模板快照' });
  }
  const allowedParametric = new Set(value.editorProfileSnapshot.allowedTools.parametric);
  const templateParametric = new Set(value.templateSnapshot.allowedCuts.map(limit => limit.shape));
  value.editorProfileSnapshot.allowedTools.parametric.forEach((tool, index) => {
    if (!templateParametric.has(tool)) {
      ctx.addIssue({
        code: 'custom',
        path: ['editorProfileSnapshot', 'allowedTools', 'parametric', index],
        message: '参数化工具必须属于来源模板允许的切口',
      });
    }
  });
  const freehandProfile = value.editorProfileSnapshot.allowedTools.freehand;
  let totalFreehandPoints = 0;
  value.operations.forEach((operation, index) => {
    if (operation.kind === 'parametric' && !allowedParametric.has(operation.shape)) {
      ctx.addIssue({ code: 'custom', path: ['operations', index, 'shape'], message: '参数化工具未被配置允许' });
    }
    if (operation.kind === 'freehand' || operation.kind === 'brush') {
      totalFreehandPoints += operation.points.length;
      if (!freehandProfile.enabled) {
        ctx.addIssue({ code: 'custom', path: ['operations', index], message: '配置未启用自由路径' });
      }
      if (operation.points.length > freehandProfile.maxPoints) {
        ctx.addIssue({ code: 'custom', path: ['operations', index, 'points'], message: '单路径点数超过配置上限' });
      }
    }
  });
  if (totalFreehandPoints > value.editorProfileSnapshot.maxTotalFreehandPoints || totalFreehandPoints > 20_000) {
    ctx.addIssue({ code: 'custom', path: ['operations'], message: '自由路径总点数超过上限' });
  }
});
export const AnyWorkSchema = z.discriminatedUnion('schemaVersion', [WorkV1Schema, WorkV2Schema]);
const PublicMetadata = { revision: z.number().int().positive(), updatedAt: IsoTimeSchema, developmentOnly: z.boolean() };
export const ExhibitSchema = z.strictObject({
  id: IdSchema, title: Text, craftId: IdSchema, category: Text, tags: z.array(Text), summary: Text,
  description: Text, media: z.array(MediaSchema).min(1), sources: z.array(SourceSchema).min(1),
  storyIds: z.array(IdSchema), templateIds: z.array(IdSchema),
  dateLabel: Text, region: Text, creator: Text, meaning: Text, sortOrder: z.number().int(), ...PublicMetadata,
});
export const StorySchema = z.strictObject({
  id: IdSchema, title: Text, personName: Text, personBio: Text, craftIds: z.array(IdSchema).min(1),
  region: Text, summary: Text, cover: MediaSchema,
  // Plain structured paragraphs, never executable HTML.
  body: z.array(z.strictObject({ type: z.literal('paragraph'), text: Text })).min(1),
  timeline: z.array(z.strictObject({ dateLabel: Text, text: Text, sources: z.array(SourceSchema).min(1) })),
  sources: z.array(SourceSchema).min(1), exhibitIds: z.array(IdSchema), templateId: IdSchema.optional(),
  sortOrder: z.number().int(), ...PublicMetadata,
});
export const FavoriteSchema = z.strictObject({ exhibitId: IdSchema, createdAt: IsoTimeSchema });
export const PaginationSchema = z.strictObject({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(50).default(12) });
export const ContentQuerySchema = PaginationSchema.extend({
  q: z.string().trim().max(100).transform(v => v.toLocaleLowerCase('en-US')).optional(),
  craftId: IdSchema.optional(), category: Text.optional(), tag: Text.optional(),
});
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().min(1).max(50) });
}
export const ErrorCodeSchema = z.enum(['INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'STORAGE_UNAVAILABLE', 'QUOTA_EXCEEDED', 'REVISION_CONFLICT', 'NETWORK_ERROR', 'TIMEOUT', 'ABORTED', 'INTERNAL_ERROR', 'UNSUPPORTED_VERSION', 'GEOMETRY_INVALID', 'RESOURCE_UNAVAILABLE', 'EXPORT_FAILED', 'PAYLOAD_TOO_LARGE', 'RATE_LIMITED']);
export const ApiErrorSchema = z.strictObject({
  code: ErrorCodeSchema, message: Text, requestId: Text,
  fieldErrors: z.array(z.strictObject({ path: Text, message: Text })),
});
const ServiceIdentity = { service: z.literal('@shoushang/api'), version: z.literal('0.1.0'), contentMode: z.literal('http') };
/** Liveness only; database availability is checked separately by /ready. */
export const HealthSchema = z.strictObject({ status: z.literal('ok'), ...ServiceIdentity });
export const ReadinessSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), database: z.literal('ready'), ...ServiceIdentity }),
  z.strictObject({ status: z.literal('not-ready'), database: z.literal('unavailable'), ...ServiceIdentity }),
]);
export type Health = z.infer<typeof HealthSchema>;
export type Readiness = z.infer<typeof ReadinessSchema>;

export type Craft = z.infer<typeof CraftSchema>;
export type TemplateVersion = z.infer<typeof TemplateVersionSchema>;
export type CutOperation = z.infer<typeof CutOperationSchema>;
export type Work = z.infer<typeof WorkSchema>;
export type TemplateVersionV1 = TemplateVersion;
export type TemplateSnapshotV2 = z.infer<typeof TemplateSnapshotV2Schema>;
export type PublicTemplate = z.infer<typeof PublicTemplateSchema>;
export type CutShapeV2 = z.infer<typeof CutShapeV2Schema>;
export type CutOperationV1 = CutOperation;
export type WorkV1 = Work;
export type RawPointV2 = z.infer<typeof RawPointV2Schema>;
export type FreehandCandidateV2 = z.infer<typeof FreehandCandidateV2Schema>;
export type BrushCandidateV2 = z.infer<typeof BrushCandidateV2Schema>;
export type ParametricCutV2 = z.infer<typeof ParametricCutV2Schema>;
export type FreehandCutV2 = z.infer<typeof FreehandCutV2Schema>;
export type BrushCutV2 = z.infer<typeof BrushCutV2Schema>;
export type CutOperationV2 = z.infer<typeof CutOperationV2Schema>;
export type EditorProfileV2 = z.infer<typeof EditorProfileV2Schema>;
export type EditorProfileLifecycleV2 = z.infer<typeof EditorProfileLifecycleV2Schema>;
export type EditorProfileRegistryEntryV2 = z.infer<typeof EditorProfileRegistryEntryV2Schema>;
export type WorkV2 = z.infer<typeof WorkV2Schema>;
export type AnyWork = z.infer<typeof AnyWorkSchema>;
export type Exhibit = z.infer<typeof ExhibitSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Media = z.infer<typeof MediaSchema>;
export type Favorite = z.infer<typeof FavoriteSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ContentQuery = z.input<typeof ContentQuerySchema>;
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type Result<T, E = ApiError> = { ok: true; value: T } | { ok: false; error: E };
