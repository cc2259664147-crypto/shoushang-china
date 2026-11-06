import { WorkSchema, WorkV2Schema } from '@shoushang/contracts';
import type { ApiError, ArtworkExporter, ArtworkRenderer, ExportInput, ExportOutput, Result, Work, WorkV2 } from '@shoushang/contracts';
import { createArtworkRenderer, createArtworkRendererV2 } from '@shoushang/artwork-renderer';
import type { ArtworkRendererV2 } from '@shoushang/artwork-renderer';
import { cardFonts, cardFontVariations } from './fonts/card-fonts';

export type { ExportInput, ExportOutput, ArtworkExporter } from '@shoushang/contracts';

export interface ExportInputV2 { readonly work: WorkV2; readonly width?: number; readonly height?: number }
export interface ArtworkExporterV2 { exportCard(input: ExportInputV2): Promise<Result<ExportOutput>> }

const FAMILY = 'ShouShangNotoSansSC';
const REQUEST_ID = 'artwork-exporter-v1';
const REQUEST_ID_V2 = 'artwork-exporter-v2';
/** Bounded phase diagnostics: timings only, never Work text/IDs; no resource preloading. */
function measured(phase: string, start: number): void {
  try {
    const name = `shoushang-png/${phase}`;
    performance.clearMeasures(name); performance.measure(name, { start, end: performance.now() });
  } catch { /* Diagnostics must not change export behavior. */ }
}
const error = (code: ApiError['code'], message: string, path: string): Result<never> =>
  ({ ok: false, error: { code, message, requestId: REQUEST_ID, fieldErrors: [{ path, message }] } });
const errorV2 = (code: ApiError['code'], message: string, path: string): Result<never> =>
  ({ ok: false, error: { code, message, requestId: REQUEST_ID_V2, fieldErrors: [{ path, message }] } });

function snapshot(input: ExportInput): Result<{ work: Work; width: number; height: number }> {
  if (!input || typeof input !== 'object') return error('INVALID_INPUT', '缺少导出参数', 'input');
  const width = input.width === undefined ? 1600 : input.width;
  const height = input.height === undefined ? 2000 : input.height;
  if (!Number.isSafeInteger(width) || width < 600 || width > 4096) return error('INVALID_INPUT', '宽度须为 600–4096 的整数', 'width');
  if (!Number.isSafeInteger(height) || height < 750 || height > 4096) return error('INVALID_INPUT', '高度须为 750–4096 的整数', 'height');
  if (width * height > 12_000_000 || height < width * 1.05 || height > width * 2.5) return error('INVALID_INPUT', '宽高比例不适合卡片或超过 1200 万像素', 'width,height');
  const candidate: unknown = input.work;
  if (candidate && typeof candidate === 'object') {
    const raw = candidate as { schemaVersion?: unknown; templateSnapshot?: { geometryVersion?: unknown; rendererVersion?: unknown }; operations?: { parameterVersion?: unknown }[] };
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) return error('UNSUPPORTED_VERSION', '作品版本不受支持', 'work.schemaVersion');
    if (raw.templateSnapshot?.geometryVersion !== undefined && raw.templateSnapshot.geometryVersion !== 1) return error('UNSUPPORTED_VERSION', '几何版本不受支持', 'work.templateSnapshot.geometryVersion');
    if (raw.templateSnapshot?.rendererVersion !== undefined && raw.templateSnapshot.rendererVersion !== 1) return error('UNSUPPORTED_VERSION', '渲染版本不受支持', 'work.templateSnapshot.rendererVersion');
    if (Array.isArray(raw.operations) && raw.operations.some(operation => operation?.parameterVersion !== undefined && operation.parameterVersion !== 1)) return error('UNSUPPORTED_VERSION', '切口参数版本不受支持', 'work.operations');
  }
  const parsed = WorkSchema.safeParse(input.work);
  if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', message: '作品数据无效', requestId: REQUEST_ID, fieldErrors: parsed.error.issues.map(issue => ({ path: issue.path.join('.') || 'work', message: issue.message })) } };
  return { ok: true, value: { work: parsed.data, width, height } };
}

function snapshotV2(input: ExportInputV2): Result<{ work: WorkV2; width: number; height: number }> {
  if (!input || typeof input !== 'object') return errorV2('INVALID_INPUT', '缺少导出参数', 'input');
  const width = input.width === undefined ? 1600 : input.width;
  const height = input.height === undefined ? 2000 : input.height;
  if (!Number.isSafeInteger(width) || width < 600 || width > 4096) return errorV2('INVALID_INPUT', '宽度须为 600–4096 的整数', 'width');
  if (!Number.isSafeInteger(height) || height < 750 || height > 4096) return errorV2('INVALID_INPUT', '高度须为 750–4096 的整数', 'height');
  if (width * height > 12_000_000 || height < width * 1.05 || height > width * 2.5) return errorV2('INVALID_INPUT', '宽高比例不适合卡片或超过 1200 万像素', 'width,height');
  const candidate: unknown = input.work;
  if (candidate && typeof candidate === 'object') {
    const raw = candidate as { schemaVersion?: unknown; templateSnapshot?: { geometryVersion?: unknown; rendererVersion?: unknown }; editorProfileSnapshot?: { profileSchemaVersion?: unknown; geometryVersion?: unknown; rendererVersion?: unknown }; operations?: { parameterVersion?: unknown }[] };
    const unknownVersion = (value: unknown, expected: number) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value !== expected;
    if (unknownVersion(raw.schemaVersion, 2)) return errorV2('UNSUPPORTED_VERSION', '作品版本不受支持', 'work.schemaVersion');
    if (unknownVersion(raw.templateSnapshot?.geometryVersion, 1)) return errorV2('UNSUPPORTED_VERSION', '模板几何版本不受支持', 'work.templateSnapshot.geometryVersion');
    if (unknownVersion(raw.templateSnapshot?.rendererVersion, 1)) return errorV2('UNSUPPORTED_VERSION', '模板渲染版本不受支持', 'work.templateSnapshot.rendererVersion');
    if (unknownVersion(raw.editorProfileSnapshot?.profileSchemaVersion, 2)) return errorV2('UNSUPPORTED_VERSION', '配置版本不受支持', 'work.editorProfileSnapshot.profileSchemaVersion');
    if (unknownVersion(raw.editorProfileSnapshot?.geometryVersion, 2)) return errorV2('UNSUPPORTED_VERSION', '几何版本不受支持', 'work.editorProfileSnapshot.geometryVersion');
    if (unknownVersion(raw.editorProfileSnapshot?.rendererVersion, 2)) return errorV2('UNSUPPORTED_VERSION', '渲染版本不受支持', 'work.editorProfileSnapshot.rendererVersion');
    if (Array.isArray(raw.operations) && raw.operations.some(operation => unknownVersion(operation?.parameterVersion, 2))) return errorV2('UNSUPPORTED_VERSION', '切口参数版本不受支持', 'work.operations');
  }
  const parsed = WorkV2Schema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', message: '作品数据无效', requestId: REQUEST_ID_V2, fieldErrors: parsed.error.issues.map(issue => ({ path: issue.path.join('.') || 'work', message: issue.message })) } };
  return { ok: true, value: { work: parsed.data, width, height } };
}

function limited<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, cause => { clearTimeout(timer); reject(cause); });
  });
}

// Finite, disjoint full-source-cmap shards. Metadata does not fetch font bytes.
// Only successful faces are retained; a failed/timed-out attempt is removed and
// cannot register a late face over a retry. Bound: one face/promise per shard.
const fontLoads = new Map<string, Promise<void>>();
const coverage = new Map<number, typeof cardFonts[number]>();
function prepareCoverage(): void {
  if (coverage.size) return;
  for (const shard of cardFonts) for (const item of shard.range.split(',')) {
    const [first, last = first] = item.slice(2).split('-').map(value => Number.parseInt(value, 16));
    for (let cp = first!; cp <= last!; cp++) coverage.set(cp, shard);
  }
}
/** Original-font coverage only; system fallback is never claimed as bundled coverage. */
export function unsupportedCardCharacters(title: string): string[] {
  prepareCoverage();
  const chars = [...title];
  return [...new Set(chars.filter((char, index) => {
    const cp = char.codePointAt(0)!;
    const variation = cardFontVariations.find(item => item.selector === cp);
    if (variation) return !variation.bases.some(base => base === chars[index - 1]?.codePointAt(0));
    return !coverage.has(cp);
  }))];
}
function fontReady(ms: number, title: string): Promise<void> {
  // First cold export pays the metadata-index work too; no pre-click warmup.
  prepareCoverage();
  const required = new Set<typeof cardFonts[number]>([cardFonts[0]]);
  for (const char of title) { const shard = coverage.get(char.codePointAt(0)!); if (shard) required.add(shard); }
  // Wait for every shard's bounded attempt, including failures. Returning on
  // the first rejection would let an immediate retry inherit another shard's
  // still-pending failed attempt from this batch.
  return Promise.allSettled([...required].map(shard => {
    let pending = fontLoads.get(shard.key);
    if (!pending) {
      let tracked: Promise<void>;
      tracked = Promise.resolve().then(async () => {
        const face = new FontFace(FAMILY, `url("${shard.url}")`, { unicodeRange: shard.range });
        await limited(face.load(), ms);
        if (fontLoads.get(shard.key) !== tracked) throw new Error('superseded font load');
        document.fonts.add(face);
        if (face.status !== 'loaded') { document.fonts.delete(face); throw new Error('font unavailable'); }
      }).catch(cause => { if (fontLoads.get(shard.key) === tracked) fontLoads.delete(shard.key); throw cause; });
      fontLoads.set(shard.key, tracked); pending = tracked;
    }
    return limited(pending, ms).catch(cause => { if (fontLoads.get(shard.key) === pending) fontLoads.delete(shard.key); throw cause; });
  })).then(outcomes => { for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason; });
}

const segments = (s: string): string[] => Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s), x => x.segment);
function titleLines(ctx: CanvasRenderingContext2D, title: string, max: number): string[] {
  const chars = segments(title), lines: string[] = [];
  let index = 0;
  for (let row = 0; row < 2 && index < chars.length; row++) {
    let line = '';
    while (index < chars.length && ctx.measureText(line + chars[index]).width <= max) line += chars[index++];
    if (row === 1 && index < chars.length) {
      while (line && ctx.measureText(line + '…').width > max) line = segments(line).slice(0, -1).join('');
      line += '…';
    }
    lines.push(line);
  }
  return lines;
}

function imagePainted(image: HTMLImageElement): boolean {
  // M06 uses an SVG image embedded inside an outer SVG. Decoding the outer
  // document alone does not prove the nested image was painted.
  const probe = document.createElement('canvas');
  probe.width = 16; probe.height = 16;
  const context = probe.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(image, 0, 0, 16, 16);
  const pixels = context.getImageData(0, 0, 16, 16).data;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) return false;
  return true;
}

type CardWork = Pick<Work, 'name' | 'status' | 'revision' | 'updatedAt'>;

function draw(ctx: CanvasRenderingContext2D, image: HTMLImageElement, work: CardWork, width: number, height: number, date: string): void {
  ctx.fillStyle = '#F8F3E9'; ctx.fillRect(0, 0, width, height);
  const art = Math.min(width * .82, height * .60), x = (width - art) / 2, y = height * .065;
  ctx.drawImage(image, x, y, art, art);
  const left = width * .09, titleSize = Math.max(26, Math.floor(width * .045)), titleY = y + art + height * .055;
  ctx.textBaseline = 'top'; ctx.fillStyle = '#29231E'; ctx.font = `400 ${titleSize}px "${FAMILY}"`;
  titleLines(ctx, work.name, width - left * 2).forEach((line, i) => ctx.fillText(line, left, titleY + i * titleSize * 1.25));
  const detailY = titleY + titleSize * 2.7;
  ctx.font = `400 ${Math.max(19, Math.floor(width * .022))}px "${FAMILY}"`;
  ctx.fillText('工艺：剪纸', left, detailY);
  ctx.fillText(work.status === 'completed' && work.revision > 0 ? `创作日期：${date}` : `草稿 · 作品时间：${date}（尚未保存）`, left, detailY + height * .033);
  ctx.fillStyle = '#5D544B'; ctx.font = `400 ${Math.max(16, Math.floor(width * .017))}px "${FAMILY}"`;
  ctx.fillText('数字体验创作，不代表实体可剪裁。', left, Math.min(height * .89, detailY + height * .085));
  ctx.fillText('手上中国', left, height * .94);
}

function filename(work: CardWork, date: string): string {
  const safe = Array.from(work.name.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, ' ').replace(/[.\s]+$/gu, '').replace(/\s+/gu, ' ').trim()).slice(0, 40).join('') || '未命名作品';
  return `手上中国_${safe}_${date}.png`;
}

export interface ArtworkExporterOptions { readonly renderer?: ArtworkRenderer; readonly resourceTimeoutMs?: number }
export interface ArtworkExporterOptionsV2 { readonly renderer?: ArtworkRendererV2; readonly resourceTimeoutMs?: number }

type SvgResult = Result<{ readonly svg: string }>;
async function exportSnapshot<TInput, TWork extends CardWork>(
  input: TInput,
  validate: (value: TInput) => Result<{ work: TWork; width: number; height: number }>,
  render: (work: TWork) => SvgResult,
  ms: number,
  failure: (code: ApiError['code'], message: string, path: string) => Result<never>,
): Promise<Result<ExportOutput>> {
    const started = performance.now();
    let checked;
    try { checked = validate(input); }
    catch { return failure('INVALID_INPUT', '作品或参数无法读取', 'input'); }
    if (!checked.ok) return checked;
    measured('snapshot-validation', started);
    const { work, width, height } = checked.value;
    const renderStart = performance.now();
    let rendered;
    try { rendered = render(work); }
    catch { return failure('EXPORT_FAILED', '作品渲染异常', 'render'); }
    if (!rendered.ok) return { ok: false, error: rendered.error };
    measured('shared-svg-render', renderStart);
    const fontStart = performance.now();
    try { await fontReady(ms, work.name); }
    catch { return failure('RESOURCE_UNAVAILABLE', '内置字体未能及时加载', 'font'); }
    measured('font-ready', fontStart);
    let url: string;
    try { url = URL.createObjectURL(new Blob([rendered.value.svg], { type: 'image/svg+xml' })); }
    catch { return failure('EXPORT_FAILED', '图像资源创建失败', 'image'); }
    let image: HTMLImageElement;
    const imageStart = performance.now();
    try { image = new Image(); image.src = url; await limited(image.decode(), ms); }
    catch { URL.revokeObjectURL(url); return failure('RESOURCE_UNAVAILABLE', '作品图像未能及时解码', 'image'); }
    measured('svg-and-nested-image-decode', imageStart);
    try {
      const canvasStart = performance.now();
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
      if (!ctx) return failure('EXPORT_FAILED', 'Canvas 不可用', 'canvas');
      if (!imagePainted(image)) return failure('RESOURCE_UNAVAILABLE', '作品图像未完整绘入卡片', 'image');
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(work.updatedAt));
      draw(ctx, image, work, width, height, date);
      measured('canvas-composition', canvasStart);
      const encodeStart = performance.now();
      const blob = await limited(new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encoding failed')), 'image/png')), ms);
      measured('png-encoding', encodeStart);
      const readStart = performance.now();
      const bytes = new Uint8Array(await limited(blob.arrayBuffer(), ms));
      measured('png-bytes-readable', readStart);
      if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return failure('EXPORT_FAILED', 'PNG 编码结果无效', 'bytes');
      measured('export-total', started);
      return { ok: true, value: { bytes, mimeType: 'image/png', filename: filename(work, date), width, height } };
    } catch { return failure('EXPORT_FAILED', '作品卡生成失败，请重试', 'export'); }
    finally { URL.revokeObjectURL(url); }
}

export function createArtworkExporter(options: ArtworkExporterOptions = {}): ArtworkExporter {
  const renderer = options.renderer ?? createArtworkRenderer(), ms = options.resourceTimeoutMs ?? 8000;
  return { exportCard: input => exportSnapshot(input, snapshot, work => renderer.render({ work, width: 1024, height: 1024, view: 'unfolded' }), ms, error) };
}

export function createArtworkExporterV2(options: ArtworkExporterOptionsV2 = {}): ArtworkExporterV2 {
  const renderer = options.renderer ?? createArtworkRendererV2(), ms = options.resourceTimeoutMs ?? 8000;
  return { exportCard: input => exportSnapshot(input, snapshotV2, work => renderer.render({ work, width: 1024, height: 1024, view: 'unfolded' }), ms, errorV2) };
}
