import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('evidence', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const report = { date: new Date().toISOString(), browser: browser.version(), url: 'http://127.0.0.1:5175', checks: [], contrast: [], limitations: ['Headless Edge only; no screen reader, mobile hardware, Safari or Android testing.'] };
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
const button = name => page.getByRole('button', { name, exact: true });
async function focusedInside() { expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true); }
try {
  await page.goto(report.url);
  await expect(page.getByRole('heading', { name: '统一表单', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(button('primary操作')).toBeFocused();
  expect(await button('primary操作').evaluate(el => getComputedStyle(el).outlineWidth)).toBe('3px');
  await page.keyboard.press('Enter'); await expect(page.getByTestId('count')).toHaveText('触发计数：1');
  await page.keyboard.press('Space'); await expect(page.getByTestId('count')).toHaveText('触发计数：2');
  expect(await button('primary操作').getAttribute('type')).toBe('button');
  await page.getByRole('button', { name: '已禁用', exact: true }).first().evaluate(el => el.click());
  await expect(page.getByTestId('count')).toHaveText('触发计数：2');
  const beforeBox = await button('运行一次演示').boundingBox();
  await button('运行一次演示').evaluate(el => { el.click(); el.click(); });
  await expect(button('运行一次演示')).toBeDisabled();
  await expect(button('运行一次演示')).toHaveAttribute('aria-busy', 'true');
  const duringBox = await button('运行一次演示').boundingBox(); expect(duringBox.width).toBe(beforeBox.width); expect(duringBox.height).toBe(beforeBox.height);
  await expect(page.getByTestId('count')).toHaveText('触发计数：3'); await expect(button('运行一次演示')).toBeEnabled();
  check('keyboard focus/Enter/Space, default button type, disabled and loading deduplicate; stable loading size and name');

  await page.locator('label').filter({ hasText: '演示名称' }).click();
  const name = page.getByLabel('演示名称', { exact: false }); await expect(name).toBeFocused();
  await button('校验演示表单').click(); await expect(name).toHaveAttribute('aria-invalid', 'true');
  const links = (await name.getAttribute('aria-describedby')).split(' ');
  expect(links.length).toBe(2);
  for (const id of links) await expect(page.locator(`[id="${id}"]`)).toBeVisible();
  await name.fill('纸'.repeat(180));
  const number = page.getByLabel('演示数量', { exact: false });
  await number.fill(''); await expect(number).toHaveValue(''); await expect(page.getByTestId('number-value')).toContainText('"number":null');
  await number.press('-'); await expect(page.getByTestId('number-value')).toContainText('"badInput":true');
  await number.press('2'); await expect(number).toHaveValue('-2');
  await number.fill('1'); await number.press('e'); await number.press('2'); await expect(number).toHaveValue('1e2');
  await number.fill('101'); await button('校验演示表单').click(); await expect(number).toHaveAttribute('aria-invalid', 'true'); await expect(number).toHaveValue('101');
  await number.fill('12'); await button('校验演示表单').click(); await expect(number).not.toHaveAttribute('aria-invalid');
  const select = page.getByLabel('演示材料', { exact: true }); await select.focus(); await select.press('ArrowDown'); await select.press('Enter'); await expect(select).toHaveValue('red');
  await page.getByLabel('演示备注', { exact: true }).fill('长文本'.repeat(300));
  check('labels, required/error descriptions, controlled Chinese/long text, number empty/minus/exponent/no clamping, native select keyboard');

  for (const exit of ['Escape', '关闭普通演示弹窗', '完成演示', '原生关闭演示']) {
    await button('打开普通弹窗').click(); const dialog = page.getByRole('dialog', { name: '普通演示弹窗' });
    await expect(dialog).toBeVisible(); await expect(button('关闭普通演示弹窗')).toBeFocused();
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); await focusedInside(); }
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Shift+Tab'); await focusedInside(); }
    // Programmatic background focus is also rejected by native modality.
    await button('primary操作').evaluate(el => el.focus()); await focusedInside();
    if (exit === 'Escape') await page.keyboard.press('Escape'); else await button(exit).click();
    await expect(dialog).not.toBeVisible(); await expect(button('打开普通弹窗')).toBeFocused();
  }
  await button('触发元素消失演示').click(); await page.keyboard.press('Escape'); await expect(page.getByRole('heading', { name: '把注意力交给当前任务' })).toBeFocused();
  check('native modal initial focus, Tab/Shift+Tab containment, background inert, Escape/close/action restore focus, disappearing trigger fallback');

  await button('打开异步确认演示').click(); const confirm = page.getByRole('dialog', { name: '异步确认演示' });
  await expect(button('保留并取消')).toBeFocused();
  await page.getByLabel('确认内容', { exact: true }).fill('用户输入保留');
  await button('执行演示').evaluate(el => {
    el.click(); el.click();
    const dialog = el.closest('dialog');
    [...dialog.querySelectorAll('button')].find(button => button.textContent.includes('保留并取消')).click();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await expect(button('执行演示')).toBeDisabled(); await expect(button('保留并取消')).toBeDisabled(); await expect(button('关闭异步确认演示')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('模拟失败，内容已保留'); await expect(page.getByTestId('attempts')).toHaveText('1');
  await expect(page.getByLabel('确认内容', { exact: true })).toHaveValue('用户输入保留');
  await page.getByLabel('模拟确认失败', { exact: true }).uncheck();
  await button('执行演示').click(); await expect(confirm).not.toBeVisible(); await expect(page.getByTestId('attempts')).toHaveText('2'); await expect(button('打开异步确认演示')).toBeFocused();
  for (const exit of ['Escape', '保留并取消', '关闭异步确认演示']) {
    await button('打开异步确认演示').click(); await expect(button('保留并取消')).toBeFocused();
    if (exit === 'Escape') await page.keyboard.press('Escape'); else await button(exit).click();
    await expect(confirm).not.toBeVisible(); await expect(button('打开异步确认演示')).toBeFocused();
  }
  check('confirm safe initial focus, async dedup, busy cancellation rules, failed input retained, retry success, all cancellation paths');

  // Observe DOM mutations in a live region while unrelated state changes.
  const unchanged = await page.evaluate(async () => {
    const region = [...document.querySelectorAll('[role=status]')].find(el => el.textContent.includes('异步演示') || el.textContent.includes('已取消演示'));
    let mutations = 0; const observer = new MutationObserver(records => { mutations += records.length; }); observer.observe(region, { subtree: true, childList: true, characterData: true });
    document.querySelector('.ss-button--primary').click(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); observer.disconnect(); return mutations;
  }); expect(unchanged).toBe(0);
  await button('重试演示').click(); await expect(page.getByRole('heading', { name: '演示请求完成，暂无条目' })).toBeVisible();
  check('unchanged live region has no DOM text mutation on unrelated rerender; failed loading state retry');

  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 400 }); await button('打开长内容弹窗').click();
  const long = page.getByRole('dialog', { name: '长内容演示弹窗' });
  const box = await long.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(400);
  expect(await long.locator('.ss-dialog-body').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  for (const name of ['关闭长内容演示弹窗', '关闭长内容']) { const box = await button(name).boundingBox(); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(400); }
  await long.locator('.ss-dialog-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(long.getByText('第24段', { exact: false })).toBeInViewport();
  await page.screenshot({ path: 'evidence/mobile-long-dialog.png' }); await button('关闭长内容').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.ss-spinner').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await button('打开普通弹窗').click(); await page.keyboard.press('Escape');
  check('360/390/768/1440 no horizontal overflow; 360x400 scrollable long dialog and reachable actions; reduced motion');

  const nativeStyles = await page.getByTestId('native-button').evaluate(el => ({ minHeight: getComputedStyle(el).minHeight, background: getComputedStyle(el).backgroundColor }));
  expect(nativeStyles.minHeight).not.toBe('44px');
  // Also compare outside the theme to plain elements in a separate document with no component styles.
  const nativeComparison = await page.evaluate(() => {
    const frame = document.createElement('iframe'); document.body.append(frame); const doc = frame.contentDocument;
    doc.body.innerHTML = '<button>原生按钮</button><input>';
    const props = ['minHeight', 'padding', 'borderRadius', 'backgroundColor', 'borderTopWidth'];
    const result = ['button', 'input'].map(tag => {
      const outside = document.createElement(tag); document.body.append(outside);
      const a = getComputedStyle(outside); const b = frame.contentWindow.getComputedStyle(doc.querySelector(tag));
      const result = props.every(prop => a[prop] === b[prop]); outside.remove(); return result;
    }); frame.remove(); return result;
  }); expect(nativeComparison).toEqual([true, true]);
  for (const el of await page.locator('.ss-button:not([disabled]),.ss-input:not(textarea)').all()) { const box = await el.boundingBox(); if (box) { expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44); } }
  check('component CSS leaves unrelated native controls unchanged; visible interaction targets >=44px');

  function luminance(hex) { const channels = hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; }
  const colors = await page.locator('.ss-theme').evaluate(el => Object.fromEntries(['paper','surface','ink','muted','primary','primary-hover','primary-active','border','focus','soft','success','warning'].map(k => [k, getComputedStyle(el).getPropertyValue(`--ss-${k}`).trim().replace('#', '').replace(/^fff$/, 'ffffff')])));
  for (const [foreground, background, minimum] of [['ink','surface',4.5],['ink','paper',4.5],['muted','surface',4.5],['muted','paper',4.5],['muted','soft',4.5],['primary','surface',4.5],['primary-hover','surface',4.5],['primary-active','surface',4.5],['border','surface',3],['border','paper',3],['focus','surface',3],['focus','paper',3],['success','surface',4.5],['warning','surface',4.5]]) {
    const a = luminance(colors[foreground]); const b = luminance(colors[background]); const ratio = (Math.max(a,b) + .05) / (Math.min(a,b) + .05); expect(ratio).toBeGreaterThanOrEqual(minimum); report.contrast.push({ foreground, background, ratio: +ratio.toFixed(2), minimum });
  } check('measured sRGB text/disabled/critical border/focus contrast');
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'evidence/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: 'evidence/desktop.png', fullPage: true });
  await button('primary操作').focus(); await page.keyboard.press('Tab'); await page.screenshot({ path: 'evidence/focus.png' });
  expect(errors).toEqual([]); check('no browser pageerror');
} finally {
  report.errors = errors; await writeFile('evidence/browser-report.json', JSON.stringify(report, null, 2)); await browser.close();
}
