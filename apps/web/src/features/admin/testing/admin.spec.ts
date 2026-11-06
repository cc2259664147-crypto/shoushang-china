import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
const root = process.env.M13_TEST_ROOT!, evidence = process.env.M13_TEST_EVIDENCE!;
const entry = '/src/features/admin/testing/index.html';
async function login(page: Page, role: 'editor' | 'admin') {
    await page.goto(entry);
    await page.getByLabel('账号', { exact: true }).fill(`browser-${role}`);
    // Do not use fill(secret): its error call log would print temporary credentials.
    await page.locator('input[type=password]').evaluate((el, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }, process.env.M13_TEST_PASSWORD!);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}
async function confirm(page: Page, reason: string) { const dialog = page.getByRole('dialog'); await dialog.getByLabel('操作原因').fill(reason); await dialog.getByRole('button', { name: '确认执行' }).click(); await expect(dialog).not.toBeVisible(); }
test('real editor upload, administrator license review, editor submission, admin publish and public unpublish', async ({ page }) => {
    await login(page, 'editor');
    await expect(page.getByRole('button', { name: '账号管理', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '媒体许可', exact: true }).click();
    await page.getByLabel('选择图片').setInputFiles(join(root, 'sample.png'));
    await page.getByRole('button', { name: '上传图片', exact: true }).click();
    await expect(page.getByText('图片和真实缩略图已保存，尚未获准公开。')).toBeVisible();
    for (const [label, value] of [['替代文本', '浏览器开发示意图'], ['作者', '项目测试自制'], ['图片来源及依据', '隔离生成图片，无文化事实'], ['许可类型', '自制测试许可'], ['署名要求', '项目开发示意']])
        await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: '保存许可', exact: true }).click();
    await expect(page.getByText('许可字段已保存。')).toBeVisible();
    await page.getByLabel('许可凭证图片').setInputFiles(join(root, 'sample.png'));
    await page.getByRole('button', { name: '上传私有凭证' }).click();
    await expect(page.getByText('私有凭证已保存。')).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await login(page, 'admin');
    await page.getByRole('button', { name: '媒体许可', exact: true }).click();
    await page.getByRole('button', { name: '维护许可' }).first().click();
    await page.getByRole('button', { name: '核验媒体许可' }).click();
    await confirm(page, '已核对自制开发图片和凭证，范围包括网站展示与缩略图');
    await expect(page.getByText('媒体许可核验已记录。')).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await login(page, 'editor');
    await page.getByRole('button', { name: '新建草稿' }).click();
    await page.getByLabel('标题', { exact: true }).fill('浏览器开发展品');
    await page.getByLabel('摘要', { exact: true }).fill('真实 HTTP 与 SQLite 验证，不计正式文化内容');
    await page.getByLabel('地区', { exact: true }).fill('开发环境');
    await page.getByLabel('工艺', { exact: true }).selectOption('craft-papercut');
    await page.getByLabel('分类', { exact: true }).selectOption('开发示意');
    await page.getByLabel('主体介绍', { exact: true }).fill('仅用于隔离测试的自制几何图片。');
    await page.getByLabel('创作者', { exact: true }).fill('项目测试');
    await page.getByLabel('纹样寓意与依据', { exact: true }).fill('开发示意，没有传统寓意主张');
    await page.getByLabel('浏览器开发示意图 · approved').check();
    await page.getByRole('button', { name: '添加来源' }).click();
    for (const [label, value] of [['来源标题', '项目开发测试记录'], ['机构或作者', '项目测试'], ['引用位置', '全文为软件开发示意'], ['来源说明', '不是文化事实依据']])
        await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: '保存新草稿修订' }).click();
    await expect(page.getByText('草稿已持久保存，尚未发布。')).toBeVisible();
    await page.getByRole('button', { name: '预览已保存修订' }).click();
    await expect(page.getByRole('heading', { name: '鉴权预览 · 保存修订 1' })).toBeVisible();
    let pub = await page.request.get('/api/v1/exhibits');
    expect((await pub.json() as {
        value: {
            total: number;
        };
    }).value.total).toBe(0);
    await page.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect(page.getByText('已提交审核。')).toBeVisible();
    await page.screenshot({ path: join(evidence, 'editor-submitted.png'), fullPage: true });
    await page.getByRole('button', { name: '退出登录' }).click();
    await login(page, 'admin');
    await page.getByRole('button', { name: '编辑与审核' }).first().click();
    await page.getByLabel('来源核验依据').fill('已逐项核对开发测试来源，内容明确仅为软件示意，不作为文化事实');
    await page.getByRole('button', { name: '记录核验通过' }).click();
    await expect(page.getByText('核验记录已保存，可确认发布。')).toBeVisible();
    await page.getByRole('button', { name: '审核发布', exact: true }).click();
    await confirm(page, '核验后的开发示意发布验证');
    await expect(page.getByText('成功：发布成功。', { exact: true })).toBeVisible();
    pub = await page.request.get('/api/v1/exhibits');
    const published = await pub.json() as {
        value: {
            items: {
                id: string;
                title: string;
            }[];
            total: number;
        };
    };
    expect(published.value.total).toBe(1);
    expect(published.value.items[0]!.title).toBe('浏览器开发展品');
    await page.screenshot({ path: join(evidence, 'admin-published.png'), fullPage: true });
    await page.getByLabel('标题', { exact: true }).fill('尚未公开的浏览器新标题');
    await page.getByRole('button', { name: '保存新草稿修订' }).click();
    await expect(page.getByText('草稿已持久保存，尚未发布。')).toBeVisible();
    const detail = await page.request.get(`/api/v1/exhibits/${published.value.items[0]!.id}`);
    expect((await detail.json() as {
        value: {
            title: string;
        };
    }).value.title).toBe('浏览器开发展品');
    await page.getByRole('button', { name: '下架', exact: true }).click();
    await confirm(page, '浏览器下架验证');
    await expect(page.getByText('下架成功，后续公开读取不可见。')).toBeVisible();
    expect((await page.request.get(`/api/v1/exhibits/${published.value.items[0]!.id}`)).status()).toBe(404);
    await page.getByRole('button', { name: '操作记录', exact: true }).click();
    await expect(page.getByText('unpublish · success', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(evidence, 'audit.png'), fullPage: true });
});
test('preserves input on real revision conflicts and keeps preview protected in a fresh context', async ({ page, browser }) => {
    await login(page, 'editor');
    await page.getByRole('button', { name: '编辑与审核' }).first().click();
    await page.getByLabel('标题', { exact: true }).fill('必须保留的冲突输入');
    const result = await page.evaluate(async () => { const root = '/api/v1/admin'; const session = await (await fetch(root + '/session')).json() as {
        value: {
            csrfToken: string;
        };
    }; const list = await (await fetch(root + '/contents')).json() as {
        value: {
            items: {
                kind: string;
                id: string;
            }[];
        };
    }; const row = list.value.items[0]!; const current = await (await fetch(`${root}/contents/${row.kind}/${row.id}`)).json() as {
        value: {
            latestRevision: number;
            draft: Record<string, unknown>;
        };
    }; const { id: _id, revision: _r, updatedAt: _u, media, ...draft } = current.value.draft; void _id; void _r; void _u; const saved = await fetch(`${root}/contents/${row.kind}/${row.id}/revisions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': session.value.csrfToken }, body: JSON.stringify({ expectedLatest: current.value.latestRevision, draft: { ...draft, title: '另一会话已经保存', mediaIds: (media as {
                    id: string;
                }[]).map(m => m.id) } }) }); return { status: saved.status, id: row.id }; });
    expect(result.status).toBe(201);
    await page.getByRole('button', { name: '保存新草稿修订' }).click();
    await expect(page.getByRole('alert')).toContainText('新修订');
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('必须保留的冲突输入');
    await page.screenshot({ path: join(evidence, 'conflict-input-preserved.png'), fullPage: true });
    const anonymous = await browser.newContext();
    try {
        expect((await anonymous.request.get(`http://127.0.0.1:5193/api/v1/admin/contents/exhibit/${result.id}/preview?revision=1`)).status()).toBe(401);
    }
    finally {
        await anonymous.close();
    }
});
test('shows actual upload failure, supports retry and does not overflow a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'editor');
    await page.getByRole('button', { name: '媒体许可', exact: true }).click();
    await page.getByLabel('选择图片').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<html>invalid disguised image</html>') });
    await page.getByRole('button', { name: '上传图片', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('可完整解码');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: join(evidence, 'narrow-upload-failure.png'), fullPage: true });
    await page.getByLabel('选择图片').setInputFiles(join(root, 'sample.png'));
    await page.getByRole('button', { name: '上传图片', exact: true }).click();
    await expect(page.getByText('图片和真实缩略图已保存，尚未获准公开。')).toBeVisible();
});
test('performs a real backup and disables an account with its old browser session invalidated',async({page,browser})=>{
    const editorContext=await browser.newContext();
    try {
        const editorPage=await editorContext.newPage();await login(editorPage,'editor');
        await login(page,'admin');await page.getByRole('button',{name:'备份',exact:true}).click();await page.getByRole('button',{name:'创建备份',exact:true}).click();await confirm(page,'隔离浏览器数据库和媒体联合备份');
        await expect(page.getByText('已接受备份任务，尚未确认成功。')).toBeVisible();
        await expect(async()=>{await page.getByRole('button',{name:'查询任务结果'}).click();await expect(page.getByText('数据库与媒体备份已校验完成。')).toBeVisible();}).toPass({timeout:15000});
        await page.screenshot({path:join(evidence,'backup-complete.png'),fullPage:true});
        // Only this runner's isolated database: advance the completed-job cooldown, not production time.
        const coolDown = () => { const raw = new DatabaseSync(join(root, 'content.sqlite')); try { raw.exec("UPDATE admin_backup_jobs SET created_at='2020-01-01T00:00:00.000Z' WHERE state='succeeded'"); } finally { raw.close(); } };
        const jobs = () => { const raw = new DatabaseSync(join(root, 'content.sqlite')); try { return raw.prepare('SELECT id,state FROM admin_backup_jobs ORDER BY rowid').all(); } finally { raw.close(); } };
        const snapshots = () => readdirSync(join(root, 'backups')).filter(name => !name.startsWith('.')).sort();
        const first = jobs(); expect(first).toHaveLength(1);
        const firstSnapshots = snapshots();
        coolDown();
        let lostJob = '', intercepted = false;
        await page.route('**/api/v1/admin/backups', async route => {
            if (route.request().method() !== 'POST' || intercepted) { await route.continue(); return; }
            intercepted = true;
            const response = await route.fetch(); expect(response.status()).toBe(202);
            const payload = await response.json() as { value: { jobId: string } }; lostJob = payload.value.jobId;
            await route.abort('failed');
        });
        await page.getByRole('button', { name: '创建备份', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('操作原因').fill('隔离浏览器数据库和媒体联合备份');
        await dialog.getByRole('button', { name: '确认执行' }).click();
        await expect(page.getByRole('alert')).toBeVisible(); await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel('操作原因')).toHaveValue('隔离浏览器数据库和媒体联合备份');
        await expect.poll(() => jobs().filter(j => j.state === 'succeeded').length).toBe(2);
        await dialog.getByRole('button', { name: '确认执行' }).click(); await expect(dialog).not.toBeVisible();
        expect(jobs()).toHaveLength(2); expect(jobs()[1]!.id).toBe(lostJob);
        await page.unroute('**/api/v1/admin/backups');
        await expect(async () => { await page.getByRole('button', { name: '查询任务结果' }).click(); await expect(page.getByText('数据库与媒体备份已校验完成。')).toBeVisible(); }).toPass();
        const secondSnapshots = snapshots(); expect(secondSnapshots.length).toBeGreaterThan(firstSnapshots.length);
        coolDown();
        await page.getByRole('button', { name: '创建备份', exact: true }).click(); await confirm(page, '隔离浏览器数据库和媒体联合备份');
        await expect(async () => { await page.getByRole('button', { name: '查询任务结果' }).click(); await expect(page.getByText('数据库与媒体备份已校验完成。')).toBeVisible(); }).toPass();
        expect(jobs()).toHaveLength(3); expect(new Set(jobs().map(j => j.id)).size).toBe(3);
        expect(snapshots().length).toBeGreaterThan(secondSnapshots.length);
        await page.screenshot({ path: join(evidence, 'backup-new-operation-and-response-loss.png'), fullPage: true });

        await page.getByRole('button',{name:'账号管理',exact:true}).click();await page.getByRole('listitem').filter({hasText:'browser-editor'}).getByRole('button',{name:'停用账号'}).click();await confirm(page,'隔离浏览器账号停用验证');
        expect((await editorPage.request.get('/api/v1/admin/contents')).status()).toBe(401);await page.screenshot({path:join(evidence,'account-disabled.png'),fullPage:true});
    }finally{await editorContext.close();}
});
