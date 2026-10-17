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
  width: z.number().int().positive().max(6000), height: z.number().int().positive().max(6000),
  kind: z.enum(['illustration', 'photograph']),
});
export const CraftSchema = z.strictObject({
  id: IdSchema, name: Text, slug: z.string().regex(/^[a-z0-9-]+$/), description: Text,
  status: z.enum(['active', 'archived']), supportsExperience: z.boolean(),
});
export const CutShapeSchema = z.enum(['circle', 'triangle', 'teardrop']);
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
export const WorkSchema = z.strictObject({
  id: IdSchema, name: Text.max(30), craftId: IdSchema,
  templateSnapshot: TemplateVersionSchema,
  palette: z.strictObject({ paper: ColorSchema, background: ColorSchema }),
  operations: z.array(CutOperationSchema).max(100), status: z.enum(['draft', 'completed']),
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  createdAt: IsoTimeSchema, updatedAt: IsoTimeSchema,
}).superRefine((v, ctx) => {
  if (v.craftId !== v.templateSnapshot.craftId) ctx.addIssue({ code: 'custom', path: ['craftId'], message: '工艺必须与模板一致' });
  if (Date.parse(v.updatedAt) < Date.parse(v.createdAt)) ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: '更新时间不能早于创建时间' });
  if (new Set(v.operations.map(o => o.id)).size !== v.operations.length) ctx.addIssue({ code: 'custom', path: ['operations'], message: '操作ID不可重复' });
  if (v.operations.some((o, i) => o.order !== i)) ctx.addIssue({ code: 'custom', path: ['operations'], message: '顺序必须从0连续递增' });
});
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
export const HealthSchema = z.strictObject({ status: z.literal('ok'), service: z.literal('@shoushang/api'), version: z.literal('0.1.0'), contentMode: z.literal('mock'), database: z.literal('not-initialized') });

export type Craft = z.infer<typeof CraftSchema>;
export type TemplateVersion = z.infer<typeof TemplateVersionSchema>;
export type CutOperation = z.infer<typeof CutOperationSchema>;
export type Work = z.infer<typeof WorkSchema>;
export type Exhibit = z.infer<typeof ExhibitSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Media = z.infer<typeof MediaSchema>;
export type Favorite = z.infer<typeof FavoriteSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ContentQuery = z.input<typeof ContentQuerySchema>;
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type Result<T, E = ApiError> = { ok: true; value: T } | { ok: false; error: E };
