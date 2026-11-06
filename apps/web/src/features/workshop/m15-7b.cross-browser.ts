import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json' with { type: 'json' };

const editorUrl = '/src/features/workshop/editor/testing.html';
const entry = profilesDocument.profiles[0]!;
const template = JSON.parse(entry.evidence.sourceTemplateCanonicalJcs);
const profile = entry.profile;
const time = '2026-10-26T00:00:00.000Z';

interface RuntimeAudit {
  readonly errors: string[];
  dispose(): void;
}

function auditRuntime(page: Page): RuntimeAudit {
  const errors: string[] = [];
  const onPageError = (error: Error) => errors.push(`pageerror: ${error.message}`);
  const onConsole = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() !== 'error') return;
    if (new URL(message.location().url || page.url()).pathname === '/favicon.ico') return;
    errors.push(`console: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  return {
    errors,
    dispose: () => {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
    },
  };
}

async function openEditor(page: Page, suffix = ''): Promise<Locator> {
  await page.goto(`${editorUrl}${suffix}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  await expect(canvas).toBeVisible();
  return canvas;
}

async function paperPosition(canvas: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return {
    x: box.x + (box.width - base) / 2 + x * base,
    y: box.y + (box.height - base) / 2 + y * base,
  };
}

async function points(canvas: Locator, coordinates: readonly (readonly [number, number])[]) {
  return Promise.all(coordinates.map(([x, y]) => paperPosition(canvas, x, y)));
}

async function drawMouse(page: Page, canvas: Locator): Promise<void> {
  const samples = await points(canvas, [[0.14, 0.20], [0.31, 0.20], [0.31, 0.42], [0.14, 0.42]]);
  await page.mouse.move(samples[0]!.x, samples[0]!.y);
  await page.mouse.down();
  for (const sample of samples.slice(1)) await page.mouse.move(sample.x, sample.y, { steps: 4 });
  await page.mouse.up();
}

async function drawPen(context: BrowserContext, page: Page, canvas: Locator): Promise<void> {
  const samples = await points(canvas, [[0.12, 0.18], [0.22, 0.18], [0.22, 0.30], [0.12, 0.30]]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...samples[0]!, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...samples[0]!, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  for (const sample of samples.slice(1)) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...sample, button: 'left', buttons: 1, pointerType: 'pen' });
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...samples.at(-1)!, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
}

async function drawTouch(context: BrowserContext, page: Page, canvas: Locator): Promise<void> {
  const samples = await points(canvas, [[0.30, 0.55], [0.39, 0.55], [0.39, 0.68], [0.30, 0.68]]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...samples[0]!, id: 1 }] });
  for (const sample of samples.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...sample, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function seedEditableWork(page: Page, database: string, workId: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(async ({ databaseName, id, workTemplate, editorProfile, timestamp }) => {
    const work = {
      id,
      name: 'M15-7B 跨浏览器作品',
      craftId: workTemplate.craftId,
      templateSnapshot: workTemplate,
      editorProfileSnapshot: editorProfile,
      palette: { paper: '#B82025', background: '#F2D9A6' },
      operations: [],
      status: 'draft',
      schemaVersion: 2,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        const works = db.createObjectStore('works', { keyPath: 'id' });
        works.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('drafts', { keyPath: 'workId' });
        db.createObjectStore('draftRevisions', { keyPath: 'workId' });
        db.createObjectStore('thumbnails', { keyPath: 'workId' });
        db.createObjectStore('favorites', { keyPath: 'exhibitId' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['drafts', 'draftRevisions'], 'readwrite');
        transaction.objectStore('drafts').put({ workId: id, work, step: 'cut', revision: 1, baseRevision: null, updatedAt: timestamp });
        transaction.objectStore('draftRevisions').put({ workId: id, revision: 1 });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, { databaseName: database, id: workId, workTemplate: template, editorProfile: profile, timestamp: time });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function assertTargets(locator: Locator): Promise<void> {
  for (let index = 0; index < await locator.count(); index += 1) {
    const box = await locator.nth(index).boundingBox();
    expect(box?.width, `target ${index + 1} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `target ${index + 1} height`).toBeGreaterThanOrEqual(44);
  }
}

test('mouse, pen, touch and keyboard edit through the real Worker without runtime errors', async ({ page, context }) => {
  const audit = auditRuntime(page);
  try {
    let canvas = await openEditor(page);
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawMouse(page, canvas);
    await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

    canvas = await openEditor(page);
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawPen(context, page, canvas);
    await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

    canvas = await openEditor(page);
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawTouch(context, page, canvas);
    await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);

    canvas = await openEditor(page, '?seed=1');
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');

    await canvas.focus();
    await page.keyboard.press('v');
    await expect(canvas).toHaveAttribute('data-tool', 'select');
    await page.keyboard.press('Tab');
    const selectNext = page.getByRole('button', { name: '选择下一个切口' });
    await expect(selectNext).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.m15b-editor')).not.toHaveAttribute('data-selected-id', '');
    await expect(canvas).toBeFocused();
    await page.keyboard.press('Delete');
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
    await page.keyboard.press('Control+Z');
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
    await page.keyboard.press('Control+Y');
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');

    await expect(canvas).toHaveAttribute('data-phase', 'idle');
    await expect(page.getByRole('status')).toContainText('空闲');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('draft save, refresh recovery, completion and PNG export form one persistent flow', async ({ page, context }, testInfo) => {
  const audit = auditRuntime(page);
  const database = `m07-test-m15-7b-${testInfo.project.name}-${Date.now()}`;
  const workId = `m15-7b-${testInfo.project.name}`;
  try {
    await seedEditableWork(page, database, workId);
    await page.goto(`/workshop/papercut?m07db=${database}&workId=${workId}&version=stored-draft`);
    const canvas = page.getByRole('application', { name: /剪纸画布/ });
    await expect(canvas).toBeVisible();
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawMouse(page, canvas);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');

    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
    await page.getByRole('button', { name: '完成并保存作品' }).click();
    await expect(page.getByText('作品已保存')).toBeVisible();

    await page.goto(`/my/works?m07db=${database}`);
    await page.getByRole('button', { name: '导出 PNG' }).click();
    await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
    const download = page.getByRole('link', { name: '下载 PNG' });
    await expect(download).toBeVisible();
    const href = await download.getAttribute('href');
    expect(href).toMatch(/^blob:/);
    const png = await page.evaluate(async url => {
      const response = await fetch(url!);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { type: response.headers.get('content-type'), size: bytes.length, signature: [...bytes.slice(0, 8)] };
    }, href);
    expect(png.type).toBe('image/png');
    expect(png.size).toBeGreaterThan(100);
    expect(png.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    expect(audit.errors).toEqual([]);
    expect(context.pages()).toHaveLength(1);
  } finally {
    audit.dispose();
  }
});

test('desktop and narrow layouts retain named 44px controls, textual state and modal focus under reduced motion', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 760 });
      const canvas = await openEditor(page, '?seed=1');
      await assertNoHorizontalOverflow(page);
      await assertTargets(page.locator('.m15b-toolbar button'));
      await expect(canvas).toHaveAttribute('aria-label', /当前工具：选择/);
      await expect(page.locator('.m15b-status')).toHaveText('空闲');
      await expect(page.locator('.m15b-selection-status')).toHaveText('未选择切口');
      await expect(page.locator('.m15b-toolbar').getByRole('button', { name: /选择/ })).toHaveAttribute('aria-pressed', 'true');
      const unnamed = await page.locator('button:visible').evaluateAll(buttons => buttons.filter(button => {
        const labelledBy = button.getAttribute('aria-labelledby');
        const labelledText = labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() : '';
        return !(button.getAttribute('aria-label')?.trim() || labelledText || button.textContent?.trim());
      }).length);
      expect(unnamed).toBe(0);

      const database = `m07-test-m15-7b-targets-${width}-${Date.now()}`;
      const workId = `m15-7b-targets-${width}`;
      await seedEditableWork(page, database, workId);
      await page.goto(`/workshop/papercut?m07db=${database}&workId=${workId}&version=stored-draft`);
      const saveDraft = page.getByRole('button', { name: '保存草稿' });
      const complete = page.getByRole('button', { name: '完成并保存作品' });
      await expect(saveDraft).toBeVisible();
      await expect(complete).toBeVisible();
      await assertTargets(saveDraft);
      await assertTargets(complete);
      await assertNoHorizontalOverflow(page);

      await page.goto(`/my/works?m07db=${database}`);
      const exportButton = page.getByRole('button', { name: '导出 PNG' });
      await expect(exportButton).toBeVisible();
      await assertTargets(exportButton);
      await exportButton.click();
      const generate = page.getByRole('button', { name: '生成 PNG 作品卡' });
      await expect(generate).toBeVisible();
      await assertTargets(generate);
      await generate.click();
      const download = page.getByRole('link', { name: '下载 PNG' });
      await expect(download).toBeVisible();
      await assertTargets(download);
      await assertNoHorizontalOverflow(page);
    }

    await openEditor(page, '?seed=1');
    const clear = page.getByRole('button', { name: '清空' });
    await clear.click();
    const dialog = page.getByRole('alertdialog', { name: '清空全部切口？' });
    await expect(dialog).toBeVisible();
    await assertTargets(dialog.getByRole('button'));
    await expect(page.getByRole('button', { name: '确认清空' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: '取消' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '确认清空' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(clear).toBeFocused();
    expect(await clear.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});
