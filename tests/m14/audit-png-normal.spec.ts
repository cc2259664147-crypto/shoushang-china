import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

test.beforeAll(() => execFileSync(process.execPath, ['--import', 'tsx', resolve('apps/api/testing/prepare-content.ts'), '--initialize', join(process.env.M14_DATA_ROOT!, 'content.sqlite')], { stdio: 'pipe' }));

test('audit normal creation, persisted recovery, PNG and confirmed rename survive reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^开始剪纸/ }).click();
  await page.getByRole('button', { name: '使用模板', exact: true }).click();
  await page.getByRole('button', { name: '圆形', exact: true }).click();
  await page.getByRole('button', { name: '确认剪切', exact: true }).click();
  await page.getByLabel('作品名称').fill('审核作品');
  await page.keyboard.press('Tab');
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /审核作品/ }).click();
  await expect(page.getByText('切口 1 / 100')).toBeVisible();
  await page.getByRole('button', { name: '完成并保存作品', exact: true }).click();
  await expect(page.getByText('作品已保存')).toBeVisible();
  await page.getByRole('button', { name: '生成 PNG 作品卡', exact: true }).click();
  await expect(page.getByText('作品卡已生成')).toBeVisible();
  expect(await page.locator('.ws-export-result img').evaluate(async element => {
    const image = element as HTMLImageElement;
    await image.decode(); return [image.naturalWidth, image.naturalHeight];
  })).toEqual([1600, 2000]);
  await page.getByRole('button', { name: '我的作品', exact: true }).click();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.getByText('共 2 件作品')).toBeVisible();
  await page.getByRole('button', { name: '改名', exact: true }).first().click();
  await page.getByLabel('作品名称').fill('审核已确认改名');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByText('作品已改名', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '审核已确认改名', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '审核已确认改名', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await page.getByRole('button', { name: '确认永久删除', exact: true }).click();
  await expect(page.getByText('作品已删除', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('共 1 件作品')).toBeVisible();
});
