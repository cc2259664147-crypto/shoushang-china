import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import profilesDocument from '../../../../../docs/qa/m15/editor-profiles-v2.json' with { type: 'json' };

const documents = profilesDocument.profiles;
const timestamp = '2026-10-26T08:00:00.000Z';
const database = () => `m07-test-m15-7d-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function template(index: number) { return JSON.parse(documents[index]!.evidence.sourceTemplateCanonicalJcs); }
function v2(id: string, profileIndex: number, name: string, status: 'draft' | 'completed' = 'completed', revision = status === 'completed' ? 1 : 0) {
  const source = template(profileIndex), profile = structuredClone(documents[profileIndex]!.profile);
  return {
    id, name, craftId: source.craftId, templateSnapshot: source, editorProfileSnapshot: profile,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [{ kind: 'parametric', id: 'seed-cut', order: 0, parameterVersion: 2, shape: profile.allowedTools.parametric[0], center: { x: profileIndex === 2 ? .7 : .2, y: profileIndex === 2 ? .7 : .3 }, width: .05, height: .05, angleDeg: 0 }], status,
    schemaVersion: 2, revision, createdAt: timestamp, updatedAt: timestamp,
  };
}
function v1(id: string, profileIndex: number, name: string) {
  const source = template(profileIndex);
  return {
    id, name, craftId: source.craftId, templateSnapshot: source,
    palette: { paper: '#B82025', background: '#F2D9A6' }, operations: [], status: 'completed',
    schemaVersion: 1, revision: 1, createdAt: timestamp, updatedAt: timestamp,
  };
}

interface Seed { works?: unknown[]; drafts?: unknown[]; revisions?: unknown[]; thumbnails?: unknown[] }
async function seed(page: Page, name: string, data: Seed) {
  await page.goto('/');
  await page.evaluate(async ({ dbName, data: rows }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 3);
    request.onupgradeneeded = () => {
      const db = request.result, works = db.createObjectStore('works', { keyPath: 'id' });
      works.createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('drafts', { keyPath: 'workId' });
      db.createObjectStore('draftRevisions', { keyPath: 'workId' });
      db.createObjectStore('thumbnails', { keyPath: 'workId' });
      db.createObjectStore('favorites', { keyPath: 'exhibitId' });
    };
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['works', 'drafts', 'draftRevisions', 'thumbnails'], 'readwrite');
      rows.works?.forEach(row => tx.objectStore('works').put(row));
      rows.drafts?.forEach(row => tx.objectStore('drafts').put(row));
      rows.revisions?.forEach(row => tx.objectStore('draftRevisions').put(row));
      rows.thumbnails?.forEach(row => tx.objectStore('thumbnails').put(row));
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }), { dbName: name, data });
}

async function raw(page: Page, name: string) {
  return page.evaluate(async dbName => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const request = indexedDB.open(dbName, 3);
    request.onsuccess = () => {
      const db = request.result, stores = ['works', 'drafts', 'draftRevisions', 'thumbnails'];
      const tx = db.transaction(stores, 'readonly'), result: Record<string, unknown[]> = {};
      stores.forEach(store => { const get = tx.objectStore(store).getAll(); get.onsuccess = () => { result[store] = get.result; }; });
      tx.oncomplete = () => { db.close(); resolve(result); }; tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }), name);
}

test('disabled-for-new editable history opens, edits and exports while copy/save-as create no partial records', async ({ page }) => {
  const name = database(), work = v2('disabled-editable', 0, '停用可编辑历史作'), legacy = v1('disabled-v1', 0, '停用来源旧作');
  await seed(page, name, { works: [work, legacy] });
  const before = structuredClone(work);
  await page.goto(`/workshop/papercut?m07db=${name}&workId=${work.id}&version=completed`);
  await expect(page.getByRole('application', { name: /剪纸画布/ })).toBeVisible();
  let records = await raw(page, name);
  expect(records.works?.find(item => (item as { id?: string }).id === work.id)).toEqual(before);
  await page.getByRole('button', { name: '清空' }).click();
  await page.getByRole('button', { name: '确认清空' }).click();
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  records = await raw(page, name);
  const savedDraft = records.drafts?.find(item => (item as { workId?: string }).workId === work.id) as { work: typeof work };
  expect(savedDraft.work.templateSnapshot).toEqual(before.templateSnapshot);
  expect(savedDraft.work.editorProfileSnapshot).toEqual(before.editorProfileSnapshot);

  await page.goto(`/my/works?m07db=${name}`);
  const card = page.locator('article').filter({ hasText: '停用可编辑历史作' });
  await expect(card.getByRole('button', { name: '复制' })).toHaveCount(0);
  await card.getByRole('button', { name: '导出 PNG' }).first().click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成。下载触发不代表已保存到设备。')).toBeVisible();

  await page.goto(`/workshop/papercut?m07db=${name}&workId=${legacy.id}&version=completed`);
  await page.getByRole('button', { name: '另存为可编辑副本' }).click();
  await expect(page.getByText(/禁止新建或另存|禁止新建/)).toBeVisible();
  records = await raw(page, name);
  expect(records.works).toHaveLength(2);
  expect(records.drafts).toHaveLength(1);
});

test('read-export-only is visibly read-only, previews/exports/rebuilds, and deletion clears every record', async ({ page }) => {
  const name = database(), work = v2('readonly-history', 1, '只读历史作品');
  await seed(page, name, { works: [work], thumbnails: [{ workId: work.id, workRevision: 1, state: 'pending' }] });
  await page.goto(`/my/works?m07db=${name}`);
  const card = page.locator('article').filter({ hasText: '只读历史作品' });
  await expect(card.getByText('只读历史作品', { exact: true }).last()).toBeVisible();
  await expect(card.getByRole('button', { name: '查看作品' })).toBeVisible();
  await expect(card.getByRole('button', { name: '复制' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '改名' })).toHaveCount(0);
  await expect(card.getByText('完成版缩略图已重建')).toBeVisible();
  await card.getByRole('button', { name: '导出 PNG' }).click();
  await page.getByRole('button', { name: '生成 PNG 作品卡' }).click();
  await expect(page.getByText('作品卡已生成。下载触发不代表已保存到设备。')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await card.getByRole('button', { name: '查看作品' }).click();
  await expect(page.getByText('此作品仅供查看和导出')).toBeVisible();
  await expect(page.locator('.m15b-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存草稿' })).toHaveCount(0);
  await page.getByRole('button', { name: '折叠视图' }).click();
  await expect(page.getByRole('button', { name: '折叠视图' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '展开视图' }).click();

  const readonlyDraft = { workId: work.id, work: { ...work, status: 'draft', revision: 1 }, step: 'preview', revision: 8, baseRevision: 1, updatedAt: timestamp };
  await seed(page, name, { drafts: [readonlyDraft], revisions: [{ workId: work.id, revision: 8 }] });
  await page.goto(`/my/works?m07db=${name}`);
  const refreshed = page.locator('article').filter({ hasText: '只读历史作品' });
  await refreshed.getByRole('button', { name: '删除' }).click();
  await page.getByRole('button', { name: '确认永久删除' }).click();
  await expect(page.getByText('作品已删除')).toBeVisible();
  const records = await raw(page, name);
  expect(records.works).toEqual([]); expect(records.drafts).toEqual([]); expect(records.thumbnails).toEqual([]);
});

test('unknown profile, snapshot mismatch and unknown version stay raw, show incompatibility, and download in backup', async ({ page }) => {
  const name = database();
  const unknownProfile = v2('unknown-profile', 2, '未知 profile');
  unknownProfile.editorProfileSnapshot.profileId = 'unregistered-profile';
  const mismatch = v2('snapshot-mismatch', 2, '快照不一致');
  mismatch.editorProfileSnapshot.maxTotalFreehandPoints = 19_999;
  const unknownVersion = { ...v2('unknown-version', 2, '未知版本'), schemaVersion: 9 };
  const originals = [unknownProfile, mismatch, unknownVersion];
  await seed(page, name, { works: originals });
  await page.goto(`/my/works?m07db=${name}`);
  await expect(page.getByText('发现 3 条损坏或不兼容记录')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载原始备份' }).click();
  const download = await downloadPromise, path = await download.path();
  if (!path) throw new Error('backup download missing');
  const backup = JSON.parse(await readFile(path, 'utf8')) as { records: { works: { value: { id?: string } }[] } };
  expect(backup.records.works.map(row => row.value.id).sort()).toEqual(['snapshot-mismatch', 'unknown-profile', 'unknown-version']);
  const sortedOriginals = structuredClone(originals).sort((a, b) => a.id.localeCompare(b.id));
  expect(((await raw(page, name)).works as typeof originals).sort((a, b) => a.id.localeCompare(b.id))).toEqual(sortedOriginals);
  for (const item of originals) {
    await page.goto(`/workshop/papercut?m07db=${name}&workId=${item.id}&version=completed`);
    await expect(page.getByRole('heading', { name: '作品无法打开' })).toBeVisible();
    await expect(page.getByText(/不受支持|不支持|损坏|未注册|不一致/)).toBeVisible();
  }
  expect(((await raw(page, name)).works as typeof originals).sort((a, b) => a.id.localeCompare(b.id))).toEqual(sortedOriginals);
});
