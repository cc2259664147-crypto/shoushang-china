import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

const pageUrl = 'http://127.0.0.1:5173/src/features/workshop/editor/testing.html';
const extensionPath = fileURLToPath(new URL('./zoom-extension/', import.meta.url));

async function setBrowserZoom(context: BrowserContext, page: Page, factor: number): Promise<number> {
  const serviceWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  return serviceWorker.evaluate(async ({ url, zoom }) => {
    interface BrowserTab { readonly id?: number; readonly url?: string }
    interface TabsApi {
      query(query: Record<string, never>): Promise<BrowserTab[]>;
      setZoom(tabId: number, zoomFactor: number): Promise<void>;
      getZoom(tabId: number): Promise<number>;
    }
    const tabsApi = (globalThis as unknown as { chrome: { tabs: TabsApi } }).chrome.tabs;
    const tab = (await tabsApi.query({})).find(candidate => candidate.url === url);
    if (tab?.id === undefined) throw new Error('未找到待缩放的编辑器标签页');
    await tabsApi.setZoom(tab.id, zoom);
    return tabsApi.getZoom(tab.id);
  }, { url: page.url(), zoom: factor });
}

async function assertNarrowLayout(page: Page, expectedWidth: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(expectedWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const buttons = page.locator('.m15b-toolbar button');
  for (let index = 0; index < await buttons.count(); index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
}

test('real browser zoom at 200% preserves 360px and 390px layouts with 44px targets', async () => {
  test.setTimeout(60_000);
  const userDataDir = await mkdtemp(join(tmpdir(), 'm15-native-zoom-'));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: false,
      viewport: { width: 780, height: 900 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.setViewportSize({ width: 780, height: 900 });
    await page.goto(pageUrl);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    const before = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale ?? null }));
    const actualZoom = await setBrowserZoom(context, page, 2);
    expect(actualZoom).toBe(2);
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBeCloseTo(before.dpr * 2, 1);
    expect(await page.evaluate(() => visualViewport?.scale ?? null)).toBe(1);
    await assertNarrowLayout(page, 390);

    await page.setViewportSize({ width: 720, height: 900 });
    await assertNarrowLayout(page, 360);
    expect(await setBrowserZoom(context, page, 1)).toBe(1);
  } finally {
    await context?.close();
    if (dirname(userDataDir) !== tmpdir() || !basename(userDataDir).startsWith('m15-native-zoom-')) {
      throw new Error('拒绝清理非测试临时目录');
    }
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
