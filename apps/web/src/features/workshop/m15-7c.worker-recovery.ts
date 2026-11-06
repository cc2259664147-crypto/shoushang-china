import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { EDITOR_RECOVERY_NOTICE } from './editor/worker/controller';

const editorUrl = '/src/features/workshop/editor/testing.html';
const CUT_A = [[0.14, 0.20], [0.31, 0.20], [0.31, 0.42], [0.14, 0.42]] as const;
const CUT_B = [[0.30, 0.55], [0.39, 0.55], [0.39, 0.68], [0.30, 0.68]] as const;

interface RuntimeAudit {
  readonly errors: string[];
  dispose(): void;
}

function auditRuntime(page: Page): RuntimeAudit {
  const errors: string[] = [];
  const onPageError = (error: Error) => errors.push(`pageerror: ${error.message}`);
  const onConsole = (message: ConsoleMessage) => {
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

async function drawCut(page: Page, canvas: Locator, coordinates: readonly (readonly [number, number])[]): Promise<void> {
  const samples = await Promise.all(coordinates.map(([x, y]) => paperPosition(canvas, x, y)));
  await page.mouse.move(samples[0]!.x, samples[0]!.y);
  await page.mouse.down();
  for (const sample of samples.slice(1)) await page.mouse.move(sample.x, sample.y, { steps: 4 });
  await page.mouse.up();
}

async function waitForRecovery(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(async () => {
    const probe = await window.m15c!.probe();
    return probe.ok ? probe.operationCount : -1;
  })).toBeGreaterThanOrEqual(0);
}

test('Worker onerror during an in-flight cut keeps the last confirmed Work and shows the recovery notice', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawCut(page, canvas, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await page.evaluate(() => window.m15c!.holdNextRequest());
    await drawCut(page, canvas, CUT_B);
    await expect(canvas).toHaveAttribute('data-phase', 'validating');
    await page.evaluate(() => window.m15c!.fault('crash'));

    await expect(page.locator('#m15b-status')).toHaveText(EDITOR_RECOVERY_NOTICE);
    const crashed = await page.evaluate(() => window.m15c!.snapshot());
    expect(crashed.operationCount).toBe(3);
    expect(crashed.canUndo).toBe(false);
    expect(crashed.canRedo).toBe(false);
    expect(crashed.workerCount).toBe(2);
    expect(crashed.liveWorkerCount).toBe(1);
    expect(crashed.statusText).toBe(EDITOR_RECOVERY_NOTICE);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    const work = await page.evaluate(() => window.m15b.getWork());
    expect(work.operations.map(operation => operation.id)).toEqual(['seed-lower', 'seed-upper', 'browser-cut-1']);

    await waitForRecovery(page);
    await drawCut(page, canvas, CUT_B);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '4');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('messageerror during an in-flight cut keeps confirmed Work and the new Worker answers', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawCut(page, canvas, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await page.evaluate(() => window.m15c!.holdNextRequest());
    await drawCut(page, canvas, CUT_B);
    await page.evaluate(() => window.m15c!.fault('messageerror'));

    await expect(page.locator('#m15b-status')).toHaveText(EDITOR_RECOVERY_NOTICE);
    const snapshot = await page.evaluate(() => window.m15c!.snapshot());
    expect(snapshot.operationCount).toBe(3);
    expect(snapshot.workerCount).toBe(2);
    expect(snapshot.liveWorkerCount).toBe(1);
    await waitForRecovery(page);
    await drawCut(page, canvas, CUT_B);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '4');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('a damaged Worker response is rejected without touching confirmed Work', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawCut(page, canvas, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await page.evaluate(() => window.m15c!.holdNextRequest());
    await drawCut(page, canvas, CUT_B);
    await page.evaluate(() => window.m15c!.fault('corrupt'));

    await expect(page.locator('#m15b-status')).toHaveText(EDITOR_RECOVERY_NOTICE);
    const snapshot = await page.evaluate(() => window.m15c!.snapshot());
    expect(snapshot.operationCount).toBe(3);
    expect(snapshot.notices).toContain(EDITOR_RECOVERY_NOTICE);
    const work = await page.evaluate(() => window.m15b.getWork());
    expect(work.operations.map(operation => operation.id)).toEqual(['seed-lower', 'seed-upper', 'browser-cut-1']);
    await waitForRecovery(page);
    await drawCut(page, canvas, CUT_B);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '4');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('postMessage failure on a new cut does not commit the candidate and recovers', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawCut(page, canvas, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await page.evaluate(() => window.m15c!.fault('post-throw'));
    await drawCut(page, canvas, CUT_B);

    await expect(page.locator('#m15b-status')).toHaveText(EDITOR_RECOVERY_NOTICE);
    const snapshot = await page.evaluate(() => window.m15c!.snapshot());
    expect(snapshot.operationCount).toBe(3);
    expect(snapshot.workerCount).toBe(2);
    const work = await page.evaluate(() => window.m15b.getWork());
    expect(work.operations).toHaveLength(3);
    await waitForRecovery(page);
    await drawCut(page, canvas, CUT_B);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '4');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('a Worker terminated silently during a request is detected and recovered', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1&requestTimeout=400');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawCut(page, canvas, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await page.evaluate(() => window.m15c!.holdNextRequest());
    await drawCut(page, canvas, CUT_B);
    await page.evaluate(() => window.m15c!.fault('silent-terminate'));

    await expect(page.locator('#m15b-status')).toHaveText(EDITOR_RECOVERY_NOTICE);
    const snapshot = await page.evaluate(() => window.m15c!.snapshot());
    expect(snapshot.operationCount).toBe(3);
    expect(snapshot.workerCount).toBe(2);
    expect(snapshot.liveWorkerCount).toBe(1);
    await waitForRecovery(page);
    await drawCut(page, canvas, CUT_B);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '4');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('late responses after switching works never overwrite the new work', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawCut(page, canvas, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
    const latePayload = await page.evaluate(() => ({
      sessionId: 'm15b-browser-session',
      requestId: 3,
      sequence: 1,
      work: window.m15b.getWork(),
      canUndo: true,
      canRedo: true,
    }));
    expect(latePayload.work.operations.map(operation => operation.id)).toEqual(['browser-cut-1']);

    await page.evaluate(() => window.m15c!.switchWork());
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '0');
    await page.evaluate(payload => window.m15c!.inject(payload, 'previous'), latePayload);
    await page.evaluate(payload => window.m15c!.inject(payload, 'active'), latePayload);
    const duplicated = await page.evaluate(() => {
      const last = window.m15c!.lastResponse() as { sessionId: string; requestId: number; sequence: number } | null;
      if (!last) throw new Error('missing last response');
      return {
        sessionId: last.sessionId, requestId: last.requestId, sequence: last.sequence,
        work: window.m15b.getWork(), canUndo: true, canRedo: true,
      };
    });
    await page.evaluate(payload => window.m15c!.inject(payload, 'active'), {
      ...duplicated,
      work: { ...duplicated.work, name: '迟到作品' },
    });

    const snapshot = await page.evaluate(() => window.m15c!.snapshot());
    expect(snapshot.workId).toBe('m15c-switched-work');
    expect(snapshot.workName).toBe('M15-7C 切换后的作品');
    expect(snapshot.operationCount).toBe(0);
    await drawCut(page, canvas, CUT_B);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '1');
    const work = await page.evaluate(() => window.m15b.getWork());
    expect(work.id).toBe('m15c-switched-work');
    expect(work.name).toBe('M15-7C 切换后的作品');
    expect(work.operations).toHaveLength(1);
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('after recovery the editor still cuts, deletes, undoes and redoes', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await page.evaluate(() => window.m15c!.fault('crash'));
    await expect(page.locator('#m15b-status')).toHaveText(EDITOR_RECOVERY_NOTICE);
    await waitForRecovery(page);

    await drawCut(page, canvas, CUT_B);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await page.locator('.m15b-toolbar').getByRole('button', { name: /选择/ }).click();
    const overlap = await paperPosition(canvas, 0.2, 0.3);
    await page.mouse.click(overlap.x, overlap.y);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-selected-id', 'seed-upper');
    await page.keyboard.press('Delete');
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await page.getByRole('button', { name: '重做' }).click();
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '2');
    expect((await page.evaluate(() => window.m15b.getWork())).operations.map(operation => operation.id))
      .toEqual(['seed-lower', 'browser-cut-1']);
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('repeated faults release every old Worker and leave no stuck request', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    for (let round = 1; round <= 3; round += 1) {
      await page.evaluate(() => window.m15c!.fault('crash'));
      await expect(page.locator('#m15b-status')).toHaveText(EDITOR_RECOVERY_NOTICE);
      await waitForRecovery(page);
      const snapshot = await page.evaluate(() => window.m15c!.snapshot());
      expect(snapshot.operationCount).toBe(2);
      expect(snapshot.workerCount).toBe(round + 1);
      expect(snapshot.liveWorkerCount).toBe(1);
      expect(snapshot.notices).toContain(EDITOR_RECOVERY_NOTICE);
    }
    await drawCut(page, canvas, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    await expect(canvas).not.toHaveAttribute('data-phase', 'validating');
    const settled = await page.evaluate(() => window.m15c!.snapshot());
    expect(settled.liveWorkerCount).toBe(1);
    expect(settled.operationCount).toBe(3);
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});

test('page unload during an in-flight request leaves no runtime errors', async ({ page }) => {
  const audit = auditRuntime(page);
  try {
    const canvas = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await page.evaluate(() => window.m15c!.holdNextRequest());
    await drawCut(page, canvas, CUT_A);
    await expect(canvas).toHaveAttribute('data-phase', 'validating');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    const reloaded = await openEditor(page, '?faults=1&seed=1');
    await page.getByRole('button', { name: /自由剪刀/ }).click();
    await drawCut(page, reloaded, CUT_A);
    await expect(page.locator('.m15b-editor')).toHaveAttribute('data-operation-count', '3');
    expect(audit.errors).toEqual([]);
  } finally {
    audit.dispose();
  }
});
