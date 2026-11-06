# M13 内容后台（待总控集成）

公开入口 `AdminPage({client?})`、`createAdminHttpClient({baseUrl?,signal?})`。由总控挂载 `/admin/*`，本模块不改全局路由。HTTP client 只接受当前同源 origin，携带 Cookie 和内存 CSRF；不使用公开 ContentClient 写入，不访问数据库、访客 IndexedDB 或 localStorage 管理令牌。

提供登录/退出、内容筛选分页、展品/故事字段草稿编辑、保存修订预览、提交审核、管理员核验/发布/下架/历史恢复、图片与私有许可凭证、审计、账号停用和备份任务。复用公共 UI，样式限定 admin-shell；409/失败保留编辑表单，写入锁防重复提交；显式重新读取会替换表单，另建副本保留输入。后台不提供模板几何、算法或任意 JSON 编辑器。

独立验证入口：`/src/features/admin/testing/index.html`，必须使用本目录 testing/vite.config.ts 与隔离 API，不能把该测试入口当作正常应用已挂载。

从项目根目录运行：

```powershell
pnpm exec tsx apps/api/src/admin/testing/run-browser.ts <新的绝对证据目录>
```

runner 建立新临时 SQLite/媒体目录和随机账号，仅在子进程环境传临时凭据，不输出密码或令牌。Playwright 使用独立上下文、禁用 trace，测试服务器拒绝复用已有库/端口；测试专用重启仅接受带标记的隔离库。浏览器测试串行覆盖完整真实 HTTP 发布链路、冲突输入保留、上传失败/重试、390px 布局、备份完成与停用旧会话。详细证据和已知部署边界见 docs/handoffs/M13.md。
