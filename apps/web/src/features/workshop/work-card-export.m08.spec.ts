import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browserModule = (path: string) => '/@fs/' + resolve(path).replaceAll('\\', '/');
test.beforeAll(async ({ browser }) => { console.log('M14 M08 browser version', browser.version()); });

test('M14 unsupported emoji and rare CJK names explicitly disclose the original font boundary', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=m08-test-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByLabel('作品名称').fill('😀𠮷'); await page.keyboard.press('Tab');
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成；名称含内置字体未覆盖字符，显示取决于设备，请检查预览')).toBeVisible();
  await expect(page.getByRole('link', { name: '下载 PNG' })).toBeVisible();
});

test('M14 actual shard network failure is explicit and retry loads the real missing resources', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=m08-test-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  const pattern = /\.woff(?:\?|$)/u;
  await page.route(pattern, route => route.abort('failed'));
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText(/RESOURCE_UNAVAILABLE/)).toBeVisible();
  await expect(page.locator('.ws-export-result img')).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole('button', { name: '重试生成 PNG' }).click();
  await expect(page.getByText('作品卡已生成')).toBeVisible();
});

test('M14 injected slow resource task reports ten seconds, cancels, retries and isolates late completion', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=m08-test-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.evaluate(() => {
    const fontLoad = FontFace.prototype.load, decode = HTMLImageElement.prototype.decode;
    FontFace.prototype.load = function () { return new Promise(resolve => setTimeout(resolve, 6000)).then(() => fontLoad.call(this)); };
    let first = true;
    HTMLImageElement.prototype.decode = function () {
      if (!first || !this.src.startsWith('blob:')) return decode.call(this);
      first = false;
      return new Promise(resolve => setTimeout(resolve, 6000)).then(() => decode.call(this));
    };
  });
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('生成已超过10秒，可取消后重试')).toBeVisible({ timeout: 14000 });
  await page.getByRole('button', { name: '取消生成' }).click();
  await expect(page.getByText('已取消本次生成')).toBeVisible();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成')).toBeVisible();
  const current = await page.locator('.ws-export-result img').getAttribute('src');
  await page.waitForTimeout(3500);
  expect(await page.locator('.ws-export-result img').getAttribute('src')).toBe(current);
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    Object.defineProperty(window, '__m14LateEncodeFinished', { value: false, writable: true });
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number) {
      setTimeout(() => encode.call(this, blob => {
        (window as unknown as { __m14LateEncodeFinished: boolean }).__m14LateEncodeFinished = true;
        callback(blob);
      }, type, quality), 1500);
    };
  });
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  const leave = page.getByRole('button', { name: '放弃修改并离开', exact: true });
  if (await leave.isVisible()) await leave.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __m14LateEncodeFinished: boolean }).__m14LateEncodeFinished)).toBe(true);
  await expect(page.locator('.ws-export-result')).toHaveCount(0);
  expect(await page.evaluate(async url => { try { await fetch(url!); return true; } catch { return false; } }, current)).toBe(false);
});

test('M14 original cmap boundary shards really load; arbitrary supported titles match original glyph metrics and pixels', async ({ page }) => {
  await page.goto('/workshop/papercut');
  const metadata = JSON.parse(await readFile(resolve('packages/artwork-exporter/src/fonts/generation.json'), 'utf8')) as { variations: { selector: number; base: number }[] };
  const variationTitles: string[] = [];
  for (let i = 0; i < metadata.variations.length; i += 15) variationTitles.push(metadata.variations.slice(i, i + 15).map(({ base, selector }) => String.fromCodePoint(base, selector)).join(''));
  const result = await page.evaluate(async ({ exporterUrl, fixtureUrl, originalUrl, variationTitles }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const original = new FontFace('M14Original', `url("${originalUrl}")`); await original.load(); document.fonts.add(original);
    // Latin/combining, CJK Extension A, adjacent pages and supported supplementary symbols/CJK (last shard).
    const names = ['ABCxyz0123，。！？é', '㐀㐁一丁丿乀仿伀龥', '\u{1F110}\u{1F111}\u{3106C}剪纸', ...variationTitles];
    const reports = [];
    for (const name of names) {
      const work = createFixtureWork(); work.name = name;
      const output = await createArtworkExporter().exportCard({ work, width: 600, height: 750 });
      const pixels = (family: string) => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 100;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.font = `32px "${family}"`; ctx.fillText(name, 10, 50);
        return { width: ctx.measureText(name).width, data: Array.from(ctx.getImageData(0, 0, 1200, 100).data) };
      };
      const a = pixels('M14Original'), b = pixels('ShouShangNotoSansSC');
      reports.push({ name, ok: output.ok, widthEqual: a.width === b.width, pixelsEqual: a.data.every((v, i) => v === b.data[i]) });
    }
    return reports;
  }, { exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'), fixtureUrl: browserModule('fixtures/src/index.ts'), originalUrl: browserModule('packages/artwork-exporter/src/fonts/NotoSansSC-Regular.otf'), variationTitles });
  for (const row of result) { expect(row.ok).toBe(true); expect(row.widthEqual, row.name).toBe(true); expect(row.pixelsEqual, row.name).toBe(true); }
});

test('M08 real Edge PNG, pixels, preview and download match', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=m08-test-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '圆形' }).click();
  await page.getByRole('button', { name: '确认剪切' }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成')).toBeVisible({ timeout: 15000 });
  const pixels = await page.evaluate(async () => {
    const image = document.querySelector<HTMLImageElement>('.ws-export-result img');
    if (!image) throw new Error('missing preview');
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(image, 0, 0);
    const all = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
    let opaque = true, holes = 0;
    for (let i = 0; i < all.length; i += 4) {
      if (all[i + 3] !== 255) opaque = false;
      if (all[i] === 255 && all[i + 1] === 255 && all[i + 2] === 238) holes++;
    }
    return { width: canvas.width, height: canvas.height, alpha: opaque, holes, corner: pixel(0, 0), paper: pixel(800, 500), bytes: Array.from(bytes) };
  });
  expect([pixels.width, pixels.height]).toEqual([1600, 2000]);
  expect(pixels.alpha).toBe(true);
  expect(pixels.corner).toEqual([248, 243, 233, 255]);
  expect(pixels.holes).toBeGreaterThan(100);
  expect(pixels.paper).toEqual([184, 32, 37, 255]);
  await page.screenshot({ path: 'packages/artwork-exporter/src/browser/evidence/desktop.png', fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 PNG' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const saved = await readFile(path!);
  await writeFile('packages/artwork-exporter/src/browser/evidence/sample.png', saved);
  expect(Array.from(saved)).toEqual(pixels.bytes);
  expect(download.suggestedFilename()).toMatch(/^手上中国_.*_\d{4}-\d{2}-\d{2}\.png$/);
});

test('M08 narrow layout keeps result actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/workshop/papercut?m07db=m08-test-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByRole('link', { name: '打开图片' })).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'packages/artwork-exporter/src/browser/evidence/narrow.png', fullPage: true });
});

test('M08 direct browser boundaries, snapshot, dates and warm export timing', async ({ page, context }) => {
  await page.goto('/workshop/papercut');
  const exporterUrl = browserModule('packages/artwork-exporter/src/index.ts');
  const fixtureUrl = browserModule('fixtures/src/index.ts');
  const report = await page.evaluate(async ({ exporterUrl, fixtureUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const exporter = createArtworkExporter();
    const work = createFixtureWork();
    work.name = '测试😀组合é安全名称';
    work.updatedAt = '2026-10-17T18:30:00Z';
    const coldStart = performance.now();
    const first = await exporter.exportCard({ work });
    const cold = performance.now() - coldStart;
    if (!first.ok) throw new Error(first.error.code + first.error.message);
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = await exporter.exportCard({ work });
      if (!result.ok) throw new Error(result.error.code);
      timings.push(performance.now() - start);
    }
    const badSize = await exporter.exportCard({ work, width: Number.NaN });
    const unknown = await exporter.exportCard({ work: { ...work, schemaVersion: 9 } as unknown as typeof work });
    const damaged = await exporter.exportCard({ work: { ...work, operations: [{ nonsense: true }] } as unknown as typeof work });
    const filenameWork = { ...work, name: '<>:/\\|?*' };
    const unsafe = await exporter.exportCard({ work: filenameWork });
    const offsetWork = { ...work, updatedAt: '2026-10-17T18:30:00+02:00' };
    const offset = await exporter.exportCard({ work: offsetWork });
    const changing = createFixtureWork();
    changing.name = '原始名称';
    const pending = exporter.exportCard({ work: changing });
    changing.name = '新名称'; changing.palette.paper = '#276B62';
    const snap = await pending;
    return { cold, timings, date: first.value.filename, badSize: badSize.ok ? 'ok' : badSize.error.code, unknown: unknown.ok ? 'ok' : unknown.error.code, damaged: damaged.ok ? 'ok' : damaged.error.code, unsafe: unsafe.ok ? unsafe.value.filename : 'error', offset: offset.ok ? offset.value.filename : 'error', snapshot: snap.ok ? snap.value.filename : 'error' };
  }, { exporterUrl, fixtureUrl });
  expect(report.date).toContain('2026-10-18');
  expect(report.badSize).toBe('INVALID_INPUT');
  expect(report.unknown).toBe('UNSUPPORTED_VERSION');
  expect(report.damaged).toBe('INVALID_INPUT');
  expect(report.unsafe).not.toMatch(/[<>:"/\\|?*]/);
  expect(report.offset).toContain('2026-10-18');
  expect(report.snapshot).toContain('原始名称');
  // On-demand fonts: explicitly load the exact title's resources before the
  // existing offline-reuse assertion. This is regression setup, not perf warmup.
  expect(await page.evaluate(async ({ exporterUrl, fixtureUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    return (await createArtworkExporter().exportCard({ work: createFixtureWork() })).ok;
  }, { exporterUrl, fixtureUrl })).toBe(true);
  await context.setOffline(true);
  const offline = await page.evaluate(async ({ exporterUrl, fixtureUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const result = await createArtworkExporter().exportCard({ work: createFixtureWork() });
    return result.ok ? 'ok' : result.error.code;
  }, { exporterUrl, fixtureUrl });
  expect(offline).toBe('ok');
  const newTitle = async () => page.evaluate(async ({ exporterUrl, fixtureUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const work = createFixtureWork(); work.name = '㐀';
    const result = await createArtworkExporter().exportCard({ work });
    return result.ok ? 'ok' : result.error.code;
  }, { exporterUrl, fixtureUrl });
  expect(await newTitle()).toBe('RESOURCE_UNAVAILABLE');
  await context.setOffline(false);
  expect(await newTitle()).toBe('ok');
  console.log('M08 Edge export timings ms', JSON.stringify(report));
});

test('M08 injected font, image, canvas and encoder failures recover on retry', async ({ page }) => {
  await page.goto('/workshop/papercut');
  const report = await page.evaluate(async ({ exporterUrl, fixtureUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const work = createFixtureWork();
    const exportOnce = async (ms = 8000) => {
      const result = await createArtworkExporter({ resourceTimeoutMs: ms }).exportCard({ work });
      return result.ok ? 'ok' : result.error.code;
    };
    const originalFont = window.FontFace;
    Object.defineProperty(window, 'FontFace', { configurable: true, value: class { load() { return new Promise<void>(() => {}); } } });
    const fontTimeout = await exportOnce(20);
    Object.defineProperty(window, 'FontFace', { configurable: true, value: class { load() { return Promise.reject(new Error('injected font failure')); } } });
    const font = await exportOnce();
    Object.defineProperty(window, 'FontFace', { configurable: true, value: originalFont });
    const retry = await exportOnce();
    const originalImage = window.Image;
    Object.defineProperty(window, 'Image', { configurable: true, value: class { set src(_value: string) {} decode() { return Promise.reject(new Error('injected image failure')); } } });
    const image = await exportOnce();
    Object.defineProperty(window, 'Image', { configurable: true, value: class { set src(_value: string) {} decode() { return new Promise<void>(() => {}); } } });
    const timeout = await exportOnce(20);
    Object.defineProperty(window, 'Image', { configurable: true, value: originalImage });
    const blank = await createArtworkExporter({ renderer: { render: () => ({ ok: true, value: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"/>', width: 1024, height: 1024, rendererVersion: 1 } }) } }).exportCard({ work });
    const blankImage = blank.ok ? 'ok' : blank.error.code;
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => null });
    const canvas = await exportOnce();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: getContext });
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value: (callback: (blob: Blob | null) => void) => callback(null) });
    const encoding = await exportOnce();
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value: toBlob });
    const finalRetry = await exportOnce();
    return { fontTimeout, font, retry, image, timeout, blankImage, canvas, encoding, finalRetry };
  }, { exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'), fixtureUrl: browserModule('fixtures/src/index.ts') });
  expect(report).toEqual({ fontTimeout: 'RESOURCE_UNAVAILABLE', font: 'RESOURCE_UNAVAILABLE', retry: 'ok', image: 'RESOURCE_UNAVAILABLE', timeout: 'RESOURCE_UNAVAILABLE', blankImage: 'RESOURCE_UNAVAILABLE', canvas: 'EXPORT_FAILED', encoding: 'EXPORT_FAILED', finalRetry: 'ok' });
});

test('M08 exports vertical and radial4 shapes, rotations, empty and 50/100 cuts', async ({ page }) => {
  await page.goto('/workshop/papercut');
  const report = await page.evaluate(async ({ exporterUrl, fixtureUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const exporter = createArtworkExporter();
    const results: string[] = [];
    for (const radial of [false, true]) for (const shape of ['circle', 'triangle', 'teardrop'] as const) {
      const work = createFixtureWork();
      if (radial) {
        work.templateSnapshot.geometry.symmetry = { kind: 'radial', sectors: 4, mirror: false };
        work.templateSnapshot.geometry.allowedRegion = [{x:.5,y:.5},{x:1,y:.5},{x:1,y:1},{x:.5,y:1}];
      }
      work.operations = [{ id: 'cut-0', order: 0, parameterVersion: 1, shape, center: radial ? {x:.7,y:.7} : {x:.25,y:.35}, width: .1, height: .12, angleDeg: 17 }];
      const result = await exporter.exportCard({ work });
      results.push(`${radial ? 'radial4' : 'vertical'}:${shape}:${result.ok ? 'ok' : result.error.code}`);
    }
    for (const count of [0, 50, 100]) {
      const work = createFixtureWork();
      if (count === 0) work.templateSnapshot.enabled = false; // Historical snapshot of a retired template.
      work.templateSnapshot.geometry.allowedRegion = [{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}];
      work.templateSnapshot.rules.minEdgeGap = .025;
      work.operations = Array.from({ length: count }, (_, index) => ({ id: `cut-${index}`, order: index, parameterVersion: 1 as const, shape: 'triangle' as const, center: {x:.25,y:.35}, width:.1, height:.12, angleDeg:0 }));
      const result = await exporter.exportCard({ work });
      results.push(`count:${count}:${result.ok ? 'ok' : result.error.code}`);
    }
    return results;
  }, { exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'), fixtureUrl: browserModule('fixtures/src/index.ts') });
  expect(report).toEqual(['vertical:circle:ok','vertical:triangle:ok','vertical:teardrop:ok','radial4:circle:ok','radial4:triangle:ok','radial4:teardrop:ok','count:0:ok','count:50:ok','count:100:ok']);
});

test('M08 double click starts one encode and switched work ignores stale result', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=m08-test-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let count = 0;
    Object.defineProperty(window, '__m08EncodingCount', { get: () => count });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value: function(this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number) {
      count++;
      setTimeout(() => original.call(this, callback, type, quality), 500);
    } });
  });
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByText('作品卡已生成')).toBeVisible({ timeout: 15000 });
  const count = await page.evaluate(() => (window as unknown as { __m08EncodingCount: number }).__m08EncodingCount);
  expect(count).toBe(1);
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await page.getByRole('button', { name: '使用模板' }).click();
  const switchConfirm = page.getByRole('button', { name: '放弃修改并切换' });
  if (await switchConfirm.isVisible()) await switchConfirm.click();
  await page.waitForTimeout(650);
  await expect(page.getByText('作品卡已生成')).toHaveCount(0);
});

test('M08 failed regeneration retains the previous PNG and offers retry', async ({ page }) => {
  await page.goto(`/workshop/papercut?m07db=m08-test-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成')).toBeVisible();
  const previous = await page.locator('.ws-export-result img').getAttribute('src');
  await page.evaluate(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value: (callback: BlobCallback) => callback(null) });
  });
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByRole('button', { name: '重试生成 PNG' })).toBeVisible();
  await expect(page.getByRole('link', { name: '下载 PNG' })).toBeVisible();
  expect(await page.locator('.ws-export-result img').getAttribute('src')).toBe(previous);
});

test('M08 long Chinese, Latin, digits and emoji titles stay within two measured lines', async ({ page }) => {
  await page.goto('/workshop/papercut');
  const result = await page.evaluate(async ({ exporterUrl, fixtureUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const original = CanvasRenderingContext2D.prototype.fillText;
    const recorded: { text: string; width: number }[] = [];
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'fillText', { configurable: true, value: function(this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
      recorded.push({ text, width: this.measureText(text).width });
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    } });
    const names = ['非遗数字剪纸创作体验作品名称展示测试样例', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234', '123456789012345678901234567890', '😀👩‍🎨🇨🇳剪纸😀👩‍🎨🇨🇳剪纸'];
    const results: { name: string; title: { text: string; width: number }[]; code: string }[] = [];
    for (const name of names) {
      recorded.length = 0;
      const work = createFixtureWork(); work.name = name;
      const exported = await createArtworkExporter().exportCard({ work, width: 600, height: 750 });
      results.push({ name: work.name, title: recorded.slice(0, recorded.findIndex(line => line.text === '工艺：剪纸')), code: exported.ok ? 'ok' : exported.error.code });
    }
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'fillText', { configurable: true, value: original });
    return results;
  }, { exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'), fixtureUrl: browserModule('fixtures/src/index.ts') });
  for (const item of result) {
    expect(item.code).toBe('ok');
    expect(item.title.length).toBeGreaterThan(0);
    expect(item.title.length).toBeLessThanOrEqual(2);
    expect(item.title.every(line => line.width <= 492)).toBe(true);
    expect(item.name).not.toContain('…');
    expect(item.title.some(line => line.text.includes('�'))).toBe(false);
  }
});

test('M08 exports the current in-memory work when IndexedDB cannot open', async ({ page }) => {
  const name = `m07-test-m08-${crypto.randomUUID()}`;
  await page.goto('/');
  await page.evaluate(databaseName => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 9);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  }), name);
  await page.goto(`/workshop/papercut?m07db=${name}`);
  await expect(page.getByText(/本地存储不可用/)).toBeVisible();
  await page.getByRole('button', { name: '使用模板' }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: '下载 PNG' })).toBeVisible();
});

test('M08 legal fully cut paper exports the renderer background without paper pixels', async ({ page }) => {
  await page.goto('/workshop/papercut');
  const result = await page.evaluate(async ({ exporterUrl, fixtureUrl, rendererUrl }) => {
    const { createArtworkExporter } = await import(exporterUrl) as typeof import('@shoushang/artwork-exporter');
    const { createFixtureWork } = await import(fixtureUrl) as typeof import('@shoushang/fixtures');
    const { createArtworkRenderer } = await import(rendererUrl) as typeof import('@shoushang/artwork-renderer');
    const work = createFixtureWork();
    work.templateSnapshot.geometry.allowedRegion = [{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}];
    work.templateSnapshot.rules.minEdgeGap = 0;
    work.templateSnapshot.allowedCuts = [{shape:'triangle',minWidth:.001,maxWidth:1,minHeight:.001,maxHeight:1}];
    work.operations = [
      {x:.125,y:.125,angle:315},{x:.375,y:.375,angle:135},
      {x:.125,y:.625,angle:315},{x:.375,y:.875,angle:135},
    ].map((cut, order) => ({ id: `cut-${order}`, order, parameterVersion: 1 as const, shape: 'triangle' as const, center: {x:cut.x,y:cut.y}, width: Math.SQRT1_2, height: Math.SQRT1_2 / 2, angleDeg: cut.angle }));
    const rendered = createArtworkRenderer().render({work,width:400,height:400,view:'unfolded'});
    const exported = await createArtworkExporter().exportCard({work});
    if (!rendered.ok || !exported.ok) return { render: rendered.ok ? 'ok' : rendered.error.code, export: exported.ok ? 'ok' : exported.error.code, pixels: [] as number[][] };
    const bitmap = await createImageBitmap(new Blob([exported.value.bytes.slice().buffer], {type:'image/png'}));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap,0,0);
    const pixels = [[350,280],[650,580],[950,880],[1250,1180]].map(([x,y]) => Array.from(ctx.getImageData(x!,y!,1,1).data));
    return { render: 'ok', export: 'ok', pixels };
  }, { exporterUrl: browserModule('packages/artwork-exporter/src/index.ts'), fixtureUrl: browserModule('fixtures/src/index.ts'), rendererUrl: browserModule('packages/artwork-renderer/src/index.ts') });
  expect(result.render).toBe('ok');
  expect(result.export).toBe('ok');
  expect(result.pixels.slice(0, 2)).toEqual([[255,255,238,255],[255,255,238,255]]);
  expect(result.pixels.every(pixel => pixel[3] === 255 && pixel.slice(0, 3).join(',') !== '184,32,37')).toBe(true);
});
