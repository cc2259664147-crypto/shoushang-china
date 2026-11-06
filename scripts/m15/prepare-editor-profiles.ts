import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TemplateVersionSchema, WorkSchema } from '@shoushang/contracts';
import type { TemplateVersion, Work } from '@shoushang/contracts';
import { createArtworkRenderer } from '@shoushang/artwork-renderer';
import { createPapercutCore, getWorkGeometry } from '@shoushang/papercut-core';
import { v1Templates } from '../content/v1-content-set';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const profileOutputPath = resolve(repositoryRoot, 'docs/qa/m15/editor-profiles-v2.json');
const evidenceOutputPath = resolve(repositoryRoot, 'docs/qa/m15/editor-profile-evidence.md');
const fixtureRoot = resolve(repositoryRoot, 'tests/fixtures/m15');
const utf8 = new TextEncoder();

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** RFC 8785/JCS for the JSON data types used by the strict contracts. */
export function canonicalizeJcs(value: unknown): string {
  const ancestors = new Set<object>();
  const serializeString = (candidate: string): string => {
    for (let index = 0; index < candidate.length; index += 1) {
      const code = candidate.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = candidate.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('JCS rejects lone Unicode surrogates');
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new TypeError('JCS rejects lone Unicode surrogates');
      }
    }
    return JSON.stringify(candidate);
  };
  const visit = (candidate: unknown): string => {
    if (candidate === null) return 'null';
    if (typeof candidate === 'boolean') return JSON.stringify(candidate);
    if (typeof candidate === 'string') return serializeString(candidate);
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError('JCS rejects non-finite numbers');
      return JSON.stringify(candidate);
    }
    if (typeof candidate === 'undefined' || typeof candidate === 'function' || typeof candidate === 'symbol' || typeof candidate === 'bigint') {
      throw new TypeError(`JCS rejects ${typeof candidate}`);
    }
    if (typeof candidate !== 'object') throw new TypeError('JCS received an unsupported value');
    if (ancestors.has(candidate)) throw new TypeError('JCS rejects cyclic values');
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        const items: string[] = [];
        for (let index = 0; index < candidate.length; index += 1) {
          if (!Object.hasOwn(candidate, index)) throw new TypeError('JCS rejects sparse arrays');
          items.push(visit(candidate[index]));
        }
        return `[${items.join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('JCS accepts only plain objects');
      if (Object.getOwnPropertySymbols(candidate).length !== 0) throw new TypeError('JCS rejects symbol keys');
      const record = candidate as Record<string, unknown>;
      const keys = Object.keys(record);
      if (Object.getOwnPropertyNames(record).length !== keys.length) throw new TypeError('JCS rejects non-enumerable properties');
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !('value' in descriptor)) throw new TypeError('JCS rejects accessor properties');
      }
      return `{${keys.sort().map(key => `${serializeString(key)}:${visit(record[key])}`).join(',')}}`;
    } finally {
      ancestors.delete(candidate);
    }
  };
  return visit(value);
}

export function sha256Utf8(text: string): string {
  return createHash('sha256').update(utf8.encode(text)).digest('hex');
}

function stableJson(value: JsonValue | object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const profileDecisions = [
  { templateId: 'template-v1-c01', profileId: 'editor-profile-v2-c01' },
  { templateId: 'template-v1-c02', profileId: 'editor-profile-v2-c02' },
  { templateId: 'template-v1-c03', profileId: 'editor-profile-v2-c03' },
] as const;

function parsedTemplates(): TemplateVersion[] {
  return v1Templates.map(template => TemplateVersionSchema.parse(template));
}

function buildProfiles() {
  const templates = parsedTemplates();
  return profileDecisions.map(decision => {
    const template = templates.find(item => item.id === decision.templateId);
    assert(template, `Missing approved template ${decision.templateId}`);
    const canonicalTemplate = canonicalizeJcs(template);
    const snapshotSha256 = sha256Utf8(canonicalTemplate);
    const parametric = template.allowedCuts.map(item => item.shape);
    const profile = {
      profileId: decision.profileId,
      profileSchemaVersion: 2,
      profileVersion: 1,
      sourceTemplate: { id: template.id, version: template.version, snapshotSha256 },
      allowedTools: {
        parametric,
        freehand: { enabled: true, minArea: 0.00001, minPerimeter: 0.01, maxPoints: 512 },
      },
      maxTotalFreehandPoints: 20000,
      geometryVersion: 2,
      rendererVersion: 2,
    };
    return {
      profile,
      lifecycle: { newWorkEnabled: true, historicalMode: 'editable' as const },
      evidence: {
        sourceTemplateCanonicalJcs: canonicalTemplate,
        profileCanonicalSha256: sha256Utf8(canonicalizeJcs(profile)),
      },
      templateName: template.name,
    };
  });
}

function createV1Work(): Work {
  const template = parsedTemplates().find(item => item.id === 'template-v1-c01');
  assert(template, 'Missing template-v1-c01');
  return WorkSchema.parse({
    id: 'work-m15-v1-compatibility',
    name: 'M15 v1 兼容基准作品',
    craftId: 'craft-papercut',
    templateSnapshot: template,
    palette: { paper: '#B82025', background: '#F2D9A6' },
    operations: [
      { id: 'cut-m15-circle', shape: 'circle', center: { x: 0.2, y: 0.3 }, width: 0.08, height: 0.08, angleDeg: 0, order: 0, parameterVersion: 1 },
      { id: 'cut-m15-teardrop', shape: 'teardrop', center: { x: 0.3, y: 0.62 }, width: 0.08, height: 0.1, angleDeg: 15, order: 1, parameterVersion: 1 },
    ],
    status: 'completed',
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
  });
}

async function fileRecord(relativePath: string, scope: string) {
  const bytes = await readFile(resolve(repositoryRoot, relativePath));
  return {
    path: relativePath.replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    schemaVersion: 1,
    geometryVersion: 1,
    rendererVersion: 1,
    scope,
  };
}

async function generateFixtures(): Promise<void> {
  const work = createV1Work();
  const validated = createPapercutCore().validate(work);
  assert(validated.ok, `v1 core validation failed: ${validated.ok ? '' : validated.error.message}`);
  const geometry = getWorkGeometry(validated.value);
  assert(geometry.ok, `v1 geometry failed: ${geometry.ok ? '' : geometry.error.message}`);
  const renderer = createArtworkRenderer();
  const folded = renderer.render({ work: validated.value, width: 800, height: 800, view: 'folded' });
  const unfolded = renderer.render({ work: validated.value, width: 800, height: 800, view: 'unfolded' });
  assert(folded.ok, `folded rendering failed: ${folded.ok ? '' : folded.error.message}`);
  assert(unfolded.ok, `unfolded rendering failed: ${unfolded.ok ? '' : unfolded.error.message}`);

  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(resolve(fixtureRoot, 'v1-work.json'), stableJson(validated.value), 'utf8');
  await writeFile(resolve(fixtureRoot, 'v1-geometry.json'), stableJson(geometry.value), 'utf8');
  await writeFile(resolve(fixtureRoot, 'v1-render-folded.svg'), folded.value.svg, 'utf8');
  await writeFile(resolve(fixtureRoot, 'v1-render-unfolded.svg'), unfolded.value.svg, 'utf8');

  const paths = [
    ['tests/fixtures/m15/v1-work.json', 'generated from the deterministic v1 Work'],
    ['tests/fixtures/m15/v1-geometry.json', 'generated by the public getWorkGeometry entry point'],
    ['tests/fixtures/m15/v1-render-folded.svg', 'generated by the public artwork renderer from this v1 Work'],
    ['tests/fixtures/m15/v1-render-unfolded.svg', 'generated by the public artwork renderer from this v1 Work'],
    ['packages/artwork-exporter/src/browser/evidence/sample.png', 'existing v1 exporter browser baseline; not claimed to correspond to this fixture Work'],
  ] as const;
  const files = await Promise.all(paths.map(([path, scope]) => fileRecord(path, scope)));
  const png = files.at(-1);
  assert(png?.sha256 === 'dbfb8aa716e8a852d401394de091f49b4e36d6b9d42a57da8724db8958256772', 'Existing exporter PNG hash changed');
  const manifest = {
    schemaVersion: 1,
    fixture: { workId: work.id, templateId: work.templateSnapshot.id, deterministic: true },
    files,
    pngRelationship: 'The existing v1 exporter browser baseline is provenance evidence only; it is not asserted to be rendered from tests/fixtures/m15/v1-work.json.',
  };
  await writeFile(resolve(fixtureRoot, 'v1-compatibility-manifest.json'), stableJson(manifest), 'utf8');
}

function evidenceMarkdown(entries: ReturnType<typeof buildProfiles>): string {
  const rows = entries.map(entry => {
    const p = entry.profile;
    return `| ${entry.templateName} | \`${p.sourceTemplate.id}\` | ${p.sourceTemplate.version} | \`${p.sourceTemplate.snapshotSha256}\` | ${p.allowedTools.parametric.join('、')} | \`${p.profileId}\` / ${p.profileVersion} |`;
  }).join('\n');
  return `# M15-0A EditorProfileV2 证据\n\n` +
    `日期：2026-10-23（Asia/Shanghai）。这些 profile 是数字体验配置，不代表传统技艺流程或文化事实。\n\n` +
    `## 模板与摘要\n\n| 模板名称 | 正式 ID | 版本 | RFC 8785/JCS SHA-256 | 原 allowedCuts | v2 profile |\n| --- | --- | ---: | --- | --- | --- |\n${rows}\n\n` +
    `模板均从 \`scripts/content/v1-content-set.ts\` 导出的 \`v1Templates\` 读取，并再次通过当前严格 \`TemplateVersionSchema.parse\`。\`records.json\` 的 \`proposedId\` 只是内容准备阶段候选，不是最终正式模板 ID，因此不能作为 profile 来源。黄金 JCS 字符串保存在 \`editor-profiles-v2.json\` 各项的 \`evidence.sourceTemplateCanonicalJcs\`。\n\n` +
    `## 统一决定\n\n三个 profile 均为 \`profileSchemaVersion=2\`、\`profileVersion=1\`、\`geometryVersion=2\`、\`rendererVersion=2\`；自由路径规则为 \`enabled=true\`、\`minArea=0.00001\`、\`minPerimeter=0.01\`、\`maxPoints=512\`，作品总自由路径点数上限为 20000。生命周期与不可变 profile 分离：\`newWorkEnabled=true\`、\`historicalMode=editable\`。已用于持久作品的 \`profileId+profileVersion\` 未来只能追加，不能修改或删除。\`rawMaxPoints=4096\` 仍只是性能候选，没有写入持久 profile，也未在本轮冻结。\n\n` +
    `## 尚未实现或验证\n\n本轮没有实现自由剪刀、v2 contracts、core 几何、Worker、UI、存储迁移或浏览器验收；没有证明现有 exporter PNG 与本轮 v1 Work 对应。M15-1 仍须按后续明确授权实现公共契约并保持 v1 兼容。\n`;
}

async function generate(): Promise<void> {
  const entries = buildProfiles();
  const output = { schemaVersion: 1, profiles: entries.map(({ templateName: _templateName, ...entry }) => entry) };
  const text = stableJson(output);
  assert(!text.includes('rawMaxPoints'), 'Persistent profile output must not contain rawMaxPoints');
  await mkdir(dirname(profileOutputPath), { recursive: true });
  await writeFile(profileOutputPath, text, 'utf8');
  await writeFile(evidenceOutputPath, evidenceMarkdown(entries), 'utf8');
  await generateFixtures();
  console.log(`profiles=${entries.length}`);
  for (const entry of entries) console.log(`${entry.profile.sourceTemplate.id}=${entry.profile.sourceTemplate.snapshotSha256}`);
}

function expectRejected(value: unknown, label: string): void {
  let rejected = false;
  try { canonicalizeJcs(value); } catch { rejected = true; }
  assert(rejected, `JCS must reject ${label}`);
}

async function selfTest(): Promise<void> {
  const ordered = { alpha: 1, beta: { x: true, y: null } };
  const reordered = { beta: { y: null, x: true }, alpha: 1 };
  assert(canonicalizeJcs(ordered) === canonicalizeJcs(reordered), 'Property order changed canonical JSON');
  assert(sha256Utf8(canonicalizeJcs(ordered)) === sha256Utf8(canonicalizeJcs(reordered)), 'Property order changed digest');
  const template = parsedTemplates()[0];
  assert(template, 'No v1 template');
  const changed = structuredClone(template);
  changed.name = `${changed.name}（变更）`;
  assert(sha256Utf8(canonicalizeJcs(template)) !== sha256Utf8(canonicalizeJcs(changed)), 'Template mutation did not change digest');
  expectRejected(Number.POSITIVE_INFINITY, 'non-finite numbers');
  expectRejected({ value: undefined }, 'undefined');
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expectRejected(cyclic, 'cycles');
  expectRejected({ value: Symbol('x') }, 'symbols');
  expectRejected({ value: () => true }, 'functions');
  expectRejected('\ud800', 'lone Unicode surrogates');
  expectRejected(Array(1), 'sparse arrays');

  const entries = buildProfiles();
  for (const [index, entry] of entries.entries()) {
    const templateEntry = parsedTemplates()[index];
    assert(templateEntry, `Missing template ${index}`);
    assert(JSON.stringify(entry.profile.allowedTools.parametric) === JSON.stringify(templateEntry.allowedCuts.map(item => item.shape)), `allowedCuts mismatch for ${templateEntry.id}`);
    const lifecycleChanged = { ...entry, lifecycle: { ...entry.lifecycle, newWorkEnabled: false } };
    assert(entry.evidence.profileCanonicalSha256 === sha256Utf8(canonicalizeJcs(lifecycleChanged.profile)), 'Lifecycle changed profile digest semantics');
  }

  const fixtureWork = WorkSchema.parse(JSON.parse(await readFile(resolve(fixtureRoot, 'v1-work.json'), 'utf8')) as unknown);
  const validated = createPapercutCore().validate(fixtureWork);
  assert(validated.ok, 'Generated v1 Work failed core validation');
  const geometry = getWorkGeometry(fixtureWork);
  assert(geometry.ok, 'Generated v1 Work failed geometry');
  assert(stableJson(geometry.value) === await readFile(resolve(fixtureRoot, 'v1-geometry.json'), 'utf8'), 'Generated geometry is not reproducible');
  const renderer = createArtworkRenderer();
  for (const view of ['folded', 'unfolded'] as const) {
    const rendered = renderer.render({ work: fixtureWork, width: 800, height: 800, view });
    assert(rendered.ok, `${view} render failed`);
    assert(rendered.value.svg === await readFile(resolve(fixtureRoot, `v1-render-${view}.svg`), 'utf8'), `${view} SVG is not reproducible`);
  }
  console.log('jcsPropertyOrder=pass');
  console.log('jcsTemplateMutation=pass');
  console.log('jcsInvalidValues=pass');
  console.log('profileAllowedCuts=pass');
  console.log('v1FixtureCompatibility=pass');
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--generate';
  if (mode === '--generate') await generate();
  else if (mode === '--self-test') await selfTest();
  else throw new Error(`Unknown mode ${mode}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    process.exitCode = 1;
  });
}
