import { expect, test } from '@playwright/test';

const editorUrl = '/src/features/workshop/editor/testing.html';
const performanceUrl = '/src/features/workshop/editor/performance.html';

async function openReady(page: import('@playwright/test').Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

async function paperPosition(canvas: import('@playwright/test').Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const base = Math.min(box.width, box.height);
  return { x: box.x + (box.width - base) / 2 + x * base, y: box.y + (box.height - base) / 2 + y * base };
}

test('real module Worker profiles 4096 points and 30-step history without transferring history', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await openReady(page, performanceUrl);
  const evidence = await page.evaluate(() => window.m15d.runPerformance());
  expect(evidence.moduleWorker).toBe(true);
  expect(evidence.rawPointCount).toBe(4096);
  expect(evidence.dispatchSamplesMs).toHaveLength(30);
  expect(evidence.dispatch.p95).toBeLessThanOrEqual(250);
  // Edge on Windows exposes rAF timestamps at 0.1 ms precision, so a nominal
  // 16.7 ms frame can be reported as high as 17.0 ms after quantization.
  expect(evidence.animationFrame.p95).toBeLessThanOrEqual(16.7 + 0.3);

  const addRequests = evidence.messages.filter(sample => sample.direction === 'request' && sample.rawPointCount === 4096);
  expect(addRequests).toHaveLength(30);
  expect(addRequests.every(sample => !sample.containsWork && !sample.containsHistory)).toBe(true);
  expect(addRequests.every(sample => sample.keys.join(',') === 'command,requestId,sequence,sessionId,type')).toBe(true);
  const addIds = new Set(addRequests.map(sample => sample.requestId));
  const addResponses = evidence.messages.filter(sample => sample.direction === 'response' && sample.sessionId === 'm15-5d-4096'
    && sample.requestId !== null && addIds.has(sample.requestId));
  expect(addResponses).toHaveLength(30);
  expect(addResponses.every(sample => sample.containsWork && !sample.containsHistory)).toBe(true);

  expect(evidence.historyFlags).toHaveLength(30);
  expect(evidence.historyFlags.every(flags => flags.canUndo && !flags.canRedo)).toBe(true);
  expect(Math.max(...evidence.historyRequestBytes) - Math.min(...evidence.historyRequestBytes)).toBeLessThanOrEqual(8);
  expect(Math.max(...evidence.historyResponseBytes) - Math.min(...evidence.historyResponseBytes)).toBeLessThanOrEqual(8);
  expect(evidence.messages.every(sample => !sample.containsHistory)).toBe(true);
  if (Array.isArray(evidence.longTasksMs)) expect(Math.max(0, ...evidence.longTasksMs)).toBeLessThanOrEqual(50);

  const boundary = await page.evaluate(() => window.m15d.runBoundary());
  expect(boundary).toEqual({ disposed: true, disposedCode: 'DISPOSED', oldSessionCode: 'SESSION_MISMATCH' });
  const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform }));
  const report = {
    moduleWorker: evidence.moduleWorker,
    rawPointCount: evidence.rawPointCount,
    dispatchSamplesMs: evidence.dispatchSamplesMs,
    dispatch: evidence.dispatch,
    animationFrameIntervalsMs: evidence.animationFrameIntervalsMs,
    animationFrame: evidence.animationFrame,
    longTasksMs: evidence.longTasksMs,
    memory: evidence.memory,
    candidateRequestBytes: addRequests.map(sample => sample.bytes),
    candidateResponseBytes: addResponses.map(sample => sample.bytes),
    historyRequestBytes: evidence.historyRequestBytes,
    historyResponseBytes: evidence.historyResponseBytes,
    historyFlags: evidence.historyFlags,
    messageAudit: {
      count: evidence.messages.length,
      noHistoryFields: evidence.messages.every(sample => !sample.containsHistory),
      addRequestCount: addRequests.length,
      addResponseCount: addResponses.length,
      dispatchRequestsContainWork: evidence.messages.some(sample => sample.direction === 'request' && sample.type === 'dispatch' && sample.containsWork),
    },
    browserVersion: browser.version(),
    ...environment,
  };
  console.log(`M15_5D_PERFORMANCE=${JSON.stringify(report)}`);
});

test('near-20k stored-point Work supports selection, move, delete, undo and redo', async ({ page }) => {
  test.setTimeout(120_000);
  await openReady(page, `${editorUrl}?large=1`);
  const editor = page.locator('.m15b-editor');
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  expect(await page.evaluate(() => window.m15b.getWork().operations.reduce(
    (total, operation) => total + (operation.kind === 'freehand' ? operation.points.length : 0), 0,
  ))).toBe(19_968);
  const start = await paperPosition(canvas, 0.7, 0.7);
  const end = await paperPosition(canvas, 0.705, 0.705);
  await page.mouse.click(start.x, start.y);
  await expect(editor).toHaveAttribute('data-selected-id', 'large-cut-38');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(1);
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(39);
  await page.getByRole('button', { name: '删除' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(2);
  expect(await page.evaluate(() => window.m15b.getWork().operations.reduce(
    (total, operation) => total + (operation.kind === 'freehand' ? operation.points.length : 0), 0,
  ))).toBe(19_456);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(3);
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(39);
  await expect(page.getByRole('button', { name: '重做' })).toBeEnabled();
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => page.evaluate(() => window.m15b.confirmedCount)).toBe(4);
  expect(await page.evaluate(() => window.m15b.getWork().operations.length)).toBe(38);
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled();
});

test('reduced motion keeps keyboard editing and focus feedback operational', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReady(page, `${editorUrl}?seed=1`);
  const canvas = page.getByRole('application', { name: /剪纸画布/ });
  const point = await paperPosition(canvas, 0.2, 0.3);
  await page.mouse.click(point.x, point.y);
  await canvas.focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
  await expect(canvas).toBeFocused();
});
