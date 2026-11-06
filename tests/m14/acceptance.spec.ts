import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
const root = process.env.M14_DATA_ROOT!;
const evidence = process.env.M14_EVIDENCE!;
test.beforeAll(() => {
  execFileSync(process.execPath, ['--import', 'tsx', resolve('apps/api/testing/prepare-content.ts'), '--initialize', join(root, 'content.sqlite')], { stdio: 'pipe' });
});
async function keyboardClick(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  await button.focus(); await expect(button).toBeFocused(); await page.keyboard.press('Enter');
}
test('normal HTTP + keyboard creation, autosave, restore, PNG pixels and work management', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^开始剪纸/ }).focus(); await page.keyboard.press('Enter');
  await keyboardClick(page, '使用模板');
  await keyboardClick(page, '圆形'); await keyboardClick(page, '确认剪切');
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await keyboardClick(page, '撤销'); await expect(page.getByText('切口 0 / 100')).toBeVisible();
  await keyboardClick(page, '重做'); await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await keyboardClick(page, '纸色 #276B62');
  await page.getByLabel('作品名称').fill('M14独立验收');
  await page.keyboard.press('Tab'); // The visible field contract applies the name on blur.
  // No manual save: wait for the real IndexedDB transaction-backed autosave status.
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: /M14独立验收/ }).click();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await expect(page.getByRole('button', { name: '纸色 #276B62' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '展开预览', exact: true }).first().click();
  await expect(page.locator('.ws-canvas svg')).toBeVisible();
  await keyboardClick(page, '完成并保存作品'); await expect(page.getByText('作品已保存')).toBeVisible();
  await keyboardClick(page, '生成 PNG 作品卡'); await expect(page.getByText('作品卡已生成')).toBeVisible();
  const pngLink = await page.getByRole('link', { name: '下载 PNG' }).boundingBox();
  expect(pngLink?.width).toBeGreaterThanOrEqual(44); expect(pngLink?.height).toBeGreaterThanOrEqual(44);
  const pixels = await page.locator('.ws-export-result img').evaluate(async element => {
    if (!(element instanceof HTMLImageElement)) throw new Error('Image required');
    await element.decode(); const canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas required'); ctx.drawImage(element, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0, colored = 0; const colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 255) transparent++;
      if (Math.abs(data[i]! - data[i + 1]!) > 20) colored++;
      if (i % 400 === 0) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return { width: canvas.width, height: canvas.height, transparent, colored, distinctSampledColors: colors.size };
  });
  expect(pixels.width).toBe(1600); expect(pixels.height).toBe(2000); expect(pixels.transparent).toBe(0);
  expect(pixels.colored).toBeGreaterThan(10000); expect(pixels.distinctSampledColors).toBeGreaterThan(10);
  const pending = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PNG' }).click();
  const download = await pending; await download.saveAs(join(evidence, 'normal-card.png'));
  const bytes = await readFile(join(evidence, 'normal-card.png')); expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(join(evidence, 'png-check.json'), JSON.stringify({ ...pixels, bytes: bytes.length }, null, 2));
  await page.getByRole('button', { name: '我的作品', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'M14独立验收', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByRole('status').filter({ hasText: '作品卡已生成' })).toBeVisible();
  for (const name of ['下载 PNG', '打开图片']) {
    const target = await page.getByRole('link', { name }).boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44); expect(target?.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: join(evidence, 'touch-works-export-dialog.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '复制', exact: true }).click(); await expect(page.getByText('共 2 件作品')).toBeVisible();
  await page.getByRole('button', { name: '改名', exact: true }).first().click();
  await page.screenshot({ path: join(evidence, 'touch-rename-dialog.png') });
  for (const name of ['取消', '保存名称']) {
    const target = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44); expect(target?.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByLabel('作品名称').fill('M14改名'); await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '作品已改名' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'M14改名', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'M14改名', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await page.screenshot({ path: join(evidence, 'touch-delete-dialog.png') });
  for (const name of ['取消', '确认永久删除']) {
    const target = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44); expect(target?.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除', exact: true }).first()).toBeFocused();
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await page.getByRole('button', { name: '确认永久删除', exact: true }).click();
  await expect(page.getByText('共 1 件作品')).toBeVisible(); await page.reload(); await expect(page.getByText('共 1 件作品')).toBeVisible();
});
for (const width of [360, 390, 768, 1440, 1920]) {
  test(`normal pages layout and DOM accessibility measurements at ${width}`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 900 });
    const samples = [];
    for (const route of ['/', '/gallery', '/stories', '/my/works', '/my/favorites', '/#about', '/workshop/papercut']) {
      await page.goto(route);
      if (route.includes('workshop')) await page.getByRole('button', { name: '使用模板', exact: true }).click();
      await expect(page.locator('h1')).toBeVisible();
      const sample = await page.evaluate(() => {
        const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        const controls = [...document.querySelectorAll('button,a,input,select,textarea')].filter(visible);
        return {
          url: location.pathname, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          smallTargets: controls.map(e => ({ tag: e.tagName, text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 60), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })).filter(r => r.width < 44 || r.height < 44),
          missingAlt: [...document.querySelectorAll('img:not([alt])')].length,
          unnamedInputs: [...document.querySelectorAll('input,select,textarea')].filter(e => !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !(e instanceof HTMLInputElement && e.type === 'hidden') && !('labels' in e && (e as HTMLInputElement).labels?.length)).map(e => e.outerHTML.slice(0, 150)),
          liveRegions: document.querySelectorAll('[role=status],[role=alert],[aria-live]').length,
          canvas: [...document.querySelectorAll('.ws-canvas svg')].map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, viewBox: e.getAttribute('viewBox') })),
        };
      });
      samples.push(sample);
      await page.screenshot({ path: join(evidence, `layout-${width}-${route.replaceAll('/', '_') || 'home'}.png`), fullPage: true });
    }
    await writeFile(join(evidence, `layout-${width}.json`), JSON.stringify({ browser: browser.version(), samples }, null, 2));
    for (const sample of samples) {
      expect(sample.scrollWidth, sample.url).toBeLessThanOrEqual(width);
      expect(sample.missingAlt, sample.url).toBe(0); expect(sample.unnamedInputs, sample.url).toEqual([]);
    }
  });
}
const primaryTargets: Record<string, string[]> = {
  '/': ['.hm-actions a', '.hm-section-head > a', '.m11-nav a', '.m11-nav button'],
  '/gallery': ['.ga-page nav a', '.ga-page form input', '.ga-page form button', '.ga-filters select', '.ga-card h2 a', '.ga-card button', '.ga-pagination a', '.ga-page .ss-empty a'],
  '/stories': ['.st-filters select', '.st-filters > a', '.st-card h2 a', '.st-pagination a', '.st-page .ss-empty a'],
  '/my/works': ['.mw-page button'],
  '/workshop/papercut': ['.ws-page button', '.ws-page input', '.ws-export-link'],
};
for (const width of [360, 390, 768, 1440, 1920]) {
  test(`primary touch targets and unobstructed layout at ${width}`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 900 });
    const samples = [];
    for (const [route, selectors] of Object.entries(primaryTargets)) {
      await page.goto(route);
      if (route === '/workshop/papercut') await page.getByRole('button', { name: '使用模板', exact: true }).click();
      if (route === '/' && width <= 650) await page.getByRole('button', { name: /菜单|导航/ }).click();
      if (route === '/gallery') await expect(page.locator('.ga-page .ss-empty a').first()).toBeVisible();
      if (route === '/stories') await expect(page.locator('.st-page .ss-empty a').first()).toBeVisible();
      if (route === '/my/works') await expect(page.getByText('还没有作品')).toBeVisible();
      await expect(page.locator('h1')).toBeVisible();
      const targets = await page.evaluate((groups) => {
        const out: { selector: string; label: string; width: number; height: number }[] = [];
        for (const selector of groups) for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          const style = getComputedStyle(element), box = element.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || !box.width || !box.height) continue;
          out.push({ selector, label: (element.getAttribute('aria-label') || element.textContent || element.getAttribute('type') || '').trim().slice(0, 50), width: box.width, height: box.height });
        }
        return out;
      }, selectors);
      expect(targets.length, route).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target.width, `${route} ${target.selector} ${target.label} width`).toBeGreaterThanOrEqual(44);
        expect(target.height, `${route} ${target.selector} ${target.label} height`).toBeGreaterThanOrEqual(44);
      }
      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(layout.scrollWidth, route).toBeLessThanOrEqual(width);
      const safeName = route.replaceAll('/', '_') || 'home';
      await page.screenshot({ path: join(evidence, `touch-${width}-${safeName}.png`), fullPage: true });
      samples.push({ route, targets, layout });
    }
    await writeFile(join(evidence, `touch-${width}.json`), JSON.stringify({ browser: browser.version(), viewport: { width, height: 900 }, samples }, null, 2));
  });
}
test('swatch edge belongs to the button and keyboard focus is visible', async ({ page }) => {
  await page.goto('/workshop/papercut');
  await page.getByRole('button', { name: '使用模板', exact: true }).click();
  const swatch = page.getByRole('button', { name: '纸色 #276B62' });
  const box = await swatch.boundingBox(); if (!box) throw new Error('paper swatch has no box');
  const swatches = await page.locator('.ws-swatch').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
  for (let i = 0; i < swatches.length; i++) for (let j = i + 1; j < swatches.length; j++) {
    const a = swatches[i]!, b = swatches[j]!;
    const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    expect(overlaps, `swatches ${i} and ${j} must not overlap`).toBe(false);
  }
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  await expect(swatch).toHaveAttribute('aria-pressed', 'true');
  await swatch.focus(); await expect(swatch).toBeFocused();
  const focus = await swatch.evaluate(element => getComputedStyle(element).outlineStyle);
  expect(focus).not.toBe('none');
  await page.screenshot({ path: join(evidence, 'touch-swatch-edge-focus.png') });
});
test('small-height portrait and landscape keep workshop actions reachable', async ({ page, browser }) => {
  const samples = [];
  for (const viewport of [{ width: 360, height: 568 }, { width: 768, height: 360 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/workshop/papercut');
    await page.getByRole('button', { name: '使用模板', exact: true }).click();
    const action = page.getByRole('button', { name: '生成 PNG 作品卡' });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
    const sample = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, paper: document.querySelector('.ws-canvas')?.getBoundingClientRect().toJSON() }));
    expect(sample.scrollWidth).toBeLessThanOrEqual(viewport.width);
    expect(sample.paper?.width).toBeCloseTo(sample.paper?.height ?? 0, 1);
    await page.screenshot({ path: join(evidence, `touch-small-height-${viewport.width}x${viewport.height}.png`) });
    samples.push({ viewport, sample });
  }
  await writeFile(join(evidence, 'touch-small-height.json'), JSON.stringify({ browser: browser.version(), samples }, null, 2));
});
test('effective 720px CSS viewport at simulated 200 percent zoom keeps workshop actions reachable', async ({ page, browser }) => {
  // A 1440px screen at 200% browser zoom has roughly 720 CSS px for media queries.
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto('/workshop/papercut');
  await page.getByRole('button', { name: '使用模板', exact: true }).click();
  const action = page.getByRole('button', { name: '生成 PNG 作品卡' });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
  const result = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
  expect(result.scrollWidth).toBeLessThanOrEqual(720);
  await page.screenshot({ path: join(evidence, 'touch-effective-zoom-200.png') });
  await writeFile(join(evidence, 'touch-effective-zoom-200.json'), JSON.stringify({ browser: browser.version(), result, note: 'Equivalent CSS viewport simulation; not actual browser zoom or physical device' }, null, 2));
});
test('real HTTP catalog intersection, pagination, detail and favorite survive refresh and history', async ({ page }) => {
  execFileSync(process.execPath, ['--import', 'tsx', resolve('tests/m14/prepare-catalog.ts'), join(root, 'content.sqlite')], { stdio: 'pipe' });
  await page.goto('/gallery'); await expect(page.locator('.ga-grid .ga-card')).toHaveCount(12);
  for (const selector of ['.ga-card h2 a', '.ga-card button', '.ga-pagination a']) {
    for (const rect of await page.locator(selector).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))) {
      expect(rect.width, selector).toBeGreaterThanOrEqual(44); expect(rect.height, selector).toBeGreaterThanOrEqual(44);
    }
  }
  await page.screenshot({ path: join(evidence, 'touch-gallery-populated.png'), fullPage: true });
  await expect(page.getByLabel('工艺')).toBeEnabled();
  await page.getByLabel('工艺').selectOption('craft-papercut'); await page.getByLabel('分类').selectOption('测试甲');
  await page.getByLabel('标签', { exact: true }).selectOption('测试偶数');
  await page.getByLabel('搜索展品').fill('  ABC  '); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.ga-grid .ga-card')).toHaveCount(5); await page.reload();
  await expect(page.locator('.ga-grid .ga-card')).toHaveCount(5); await expect(page.getByLabel('搜索展品')).toHaveValue('abc');
  await page.goto('/gallery'); await expect(page.locator('.ga-grid .ga-card')).toHaveCount(12);
  await page.getByRole('link', { name: '下一页', exact: true }).click(); await expect(page.getByText('第 2 / 3 页 · 共 25 件')).toBeVisible();
  await page.locator('.ga-card h2 a').first().click();
  const back = await page.getByRole('link', { name: '返回展馆列表' }).boundingBox();
  expect(back?.width).toBeGreaterThanOrEqual(44); expect(back?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByText('第 2 / 3 页 · 共 25 件')).toBeVisible();
  await page.goForward(); await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '收藏', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '收藏', exact: true })).toBeVisible();
});
test('record computable solid-background text contrast with explicit exclusions', async ({ page }) => {
  const pages = [];
  for (const route of ['/', '/gallery', '/stories', '/my/works', '/workshop/papercut']) {
    await page.goto(route); await expect(page.locator('h1')).toBeVisible();
    if (route.includes('workshop')) await page.getByRole('button', { name: '使用模板', exact: true }).click();
    // Settle finite CSS transitions before measuring static text contrast.
    await page.evaluate(async () => {
      await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
    });
    const values = await page.evaluate(() => {
      const rows = [], excluded = [];
      function rgb(color: string): number[] | null {
        const match = /^rgba?\(([^)]+)\)$/u.exec(color); if (!match) return null;
        const values = match[1]!.split(',').map(Number); return values.length === 3 || values[3] === 1 ? values.slice(0, 3) : null;
      }
      function luminance(values: number[]) { return values.map(n => { const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0); }
      for (const element of document.querySelectorAll('body *')) {
        const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent?.trim()).filter(Boolean).join(' ');
        if (!text || !element.getClientRects().length || getComputedStyle(element).visibility !== 'visible') continue;
        const style = getComputedStyle(element), foreground = rgb(style.color); let background: number[] | null = null, reason = '';
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor);
          if (Number(css.opacity) !== 1 || css.backgroundImage !== 'none' || css.filter !== 'none') { reason = 'opacity, image/gradient or filter needs manual sampling'; break; }
          const color = rgb(css.backgroundColor);
          if (color) { background = color; break; }
          if (css.backgroundColor !== 'rgba(0, 0, 0, 0)') { reason = 'translucent background'; break; }
        }
        if (!foreground || !background || reason) { excluded.push({ text: text.slice(0, 70), reason: reason || 'no resolved opaque foreground/background' }); continue; }
        const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const fontSize = parseFloat(style.fontSize), fontWeight = parseInt(style.fontWeight), required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        rows.push({ text: text.slice(0, 70), foreground, background, fontSize, fontWeight, ratio, required, meets: ratio >= required });
      }
      return { rows, excluded };
    });
    pages.push({ route, ...values });
  }
  await writeFile(join(evidence, 'contrast.json'), JSON.stringify(pages, null, 2));
  expect(pages.every(p => p.rows.length > 0)).toBe(true);
});
