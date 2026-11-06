# M13 管理 HTTP 模块（待总控集成）

生产入口尚未注册本模块。由宿主唯一持有 `ContentDatabase`，调用 `app.register(adminRoutes, options)`；模块不另建内容库。安全、迁移、权限矩阵和实际证据见 `docs/handoffs/M13.md` 的当前实施记录。

```ts
import { adminRoutes, assertAdminListener } from './admin';
await app.register(adminRoutes, {
  database, origin: 'https://example.invalid', securityMode: 'https',
  listenHost: '127.0.0.1', mediaRoot: '/absolute/private/media', backupRoot: '/absolute/private/backups',
});
// Local HTTP must EXPLICITLY use loopback-http, a localhost/127.0.0.1 Origin and loopback listenHost.
// After listen, the host calls assertAdminListener(app, options); every admin request also verifies it.
```

上例域名是配置示例，没有部署。不得把 mediaRoot/backupRoot 指向静态目录或另挂静态服务；固定根只允许服务器写入，部署设置私有 ACL。反向代理保持同源、no-store、请求体上限，不缓存媒体，不能用 X-Forwarded-* 冒充可信 Origin/监听地址。HTTPS 模式使用 Secure Cookie；本地模式还检查实际 `server.address()`，配置 loopback 但绑定 0.0.0.0 时拒绝管理请求。

## HTTP

后台前缀 `/api/v1/admin`，请求/结果严格白名单。除 `/csrf`、`POST /session` 外全部后台接口逐请求鉴权。写入要求精确 Origin 和 `X-CSRF-Token`。登录先 GET /csrf 取得挑战 Cookie 和 csrfToken，POST /session 提交 `{username,password}`；成功会话 Cookie 为 HttpOnly/SameSite=Strict/Path=/api/v1/admin，HTTPS 模式 Secure。GET /session 恢复当前 CSRF，DELETE /session 注销返回204。

成功 `{ok:true,value}`；失败 `{ok:false,error:{code,message,requestId,fieldErrors}}`。400字段错误、401会话无效、403权限/CSRF/Origin、404不可访问、409修订或幂等冲突、413文件过大、429限流、500内部失败。错误不输出 SQL、密码摘要、令牌、凭证或内部路径。JSON bodyLimit=256KiB，图片=5MiB。未知/重复查询参数拒绝。

| 方法 / 相对路径 | 输入与返回 |
| --- | --- |
| GET /contents | kind/state/q/page/pageSize → 分页摘要，含编辑头与公开头 |
| POST /contents | `{kind:'exhibit'|'story',draft,expectedLatest:null}` → 201 新草稿 |
| GET /contents/:kind/:id | 可选 revision → `{draft,revision,latestRevision,publicRevision,state,review}` |
| POST /contents/:kind/:id/revisions | `{draft,expectedLatest}` → 201 新不可变草稿 |
| GET /contents/:kind/:id/history | page/pageSize → 历史摘要 |
| GET /contents/:kind/:id/preview | revision 必填 → 鉴权保存修订，结构化纯文本 |
| POST /contents/:kind/:id/submit | `{revision,expectedLatest}` → pending，完整候选校验 |
| POST /contents/:kind/:id/review | 管理员 `{revision,expectedLatest,decision:'approved'|'rejected',evidence:{sources,identity?,quotations?}}`；故事必须身份/引用依据 → reviewId |
| POST /contents/:kind/:id/publish | 管理员 `{revision,expectedLatest,expectedPublic:number|null,reviewId}` + Idempotency-Key |
| POST /contents/:kind/:id/unpublish | 管理员 `{expectedLatest,expectedPublic,reason}` + Idempotency-Key |
| POST /contents/:kind/:id/restore | 管理员 `{sourceRevision,expectedLatest,reason}` + Idempotency-Key → 新草稿，仍须审核发布 |
| GET /vocabulary | 已发布工艺/模板及分类/标签词表，只读选择 |
| POST /media | application/octet-stream 图片二进制 → 201 `{id,revision,width,height,format,thumbnailReady,state:'staged'}` |
| GET /media | page/pageSize → 台账摘要（无内部文件键、凭证引用；其他编辑不见内部许可 URL） |
| PATCH /media/:id/license | 上传者/管理员 `{expectedRevision,alt,author,source,licenseType,usageScope,attribution,licenseUrl?,kind?}`；使用范围批准值 site-display-and-thumbnail；仅 staged 可改 |
| PUT /media/:id/proof | 上传者/管理员，受同样解码限制的图片二进制；首期不收 PDF，凭证不可替换或公开 |
| POST /media/:id/review | 管理员 `{expectedRevision,decision:'approved',reason,verifiedScope:'site-display-and-thumbnail'}` |
| POST /media/:id/revoke | 管理员 `{expectedRevision,reason}` + Idempotency-Key |
| GET /media/:id/:variant | 鉴权 original/thumbnail；proof 仅上传者/管理员，撤权图片拒绝，凭证保留供追溯 |
| GET /audit、/accounts | 管理员 page/pageSize，无密码摘要/令牌 |
| POST /accounts/:id/disable | 管理员 `{expectedVersion,reason}` + Idempotency-Key，禁止停用自己/最后管理员 |
| POST /backups | 管理员 `{reason}` + Idempotency-Key → 202 queued；并不代表完成 |
| GET /backups/:id | 管理员查询 queued/running/succeeded/failed，不返回服务器路径 |

分页默认12，最大50。实际 audit/media 没有额外 action/state 筛选参数；内容列表支持类型/状态/标题，UI 分页可用。所有受控幂等键为16～128字符的字母数字/下划线/短横线，建议 UUID。

草稿按公开字段命名，但可缺字段/部分来源，客户端不能传 id/revision/updatedAt/media/cover，配图用 `mediaIds`（故事最多1张）。服务器将当前台账白名单媒体写入不可变修订。提交/发布须完整公开 schema，缺来源/许可或关联失败拒绝。新增修订不修改公开指针。正文只接收受控段落和纯文本，不能编辑模板几何或执行代码。

公开图片路径为 `/api/v1/media/:id/original|thumbnail`，只接受 approved 且被当前有效公开内容引用的图片；每次重新查撤权状态与文件哈希。没有静态直出路径，凭证永远不进入公开 DTO。所有输出重编码 PNG，保留原输入格式作为台账信息。已下载文件不能收回。

## 维护命令

只允许部署维护者通过 OS 权限访问私有数据库，以下占位路径须换为其有权维护的绝对路径。**本轮未对实际库或管理员执行这些命令。** 初始化/重置密码从隐藏 TTY 两次输入；受控 stdin 自动化也要求两行相同密码，不接受 argv/env 密码，不在报告/日志输出。测试凭据单独随机生成。

```powershell
pnpm exec tsx apps/api/src/admin/maintenance.ts create-account C:/private/content.sqlite account-name admin
pnpm exec tsx apps/api/src/admin/maintenance.ts reset-password C:/private/content.sqlite account-name admin
pnpm exec tsx apps/api/src/admin/maintenance.ts disable-account C:/private/content.sqlite account-name
pnpm exec tsx apps/api/src/admin/maintenance.ts add-category C:/private/content.sqlite 经确认的分类
pnpm exec tsx apps/api/src/admin/maintenance.ts add-tag C:/private/content.sqlite 经确认的标签
# 停止全部宿主/复制进程后，才可恢复已过期维护租约或进行只读媒体对账：
pnpm exec tsx apps/api/src/admin/maintenance.ts recover-maintenance C:/private/content.sqlite --all-hosts-stopped
pnpm exec tsx apps/api/src/admin/maintenance.ts inspect-media C:/private/content.sqlite C:/private/media --all-hosts-stopped
# restore 的第二参数是备份目录（内含manifest），第三参数必须为不存在的新目录：
pnpm exec tsx apps/api/src/admin/maintenance.ts restore C:/private/backups/job-id C:/private/new-restored --all-hosts-stopped
# 恢复会停用全部账号。核对停用/撤权安全账本并完成许可复核后才可受控重新启用：
pnpm exec tsx apps/api/src/admin/maintenance.ts enable-account C:/private/new-restored/content.sqlite account-name
```

新库构造会迁移，不播种账号。维护者须先做一致性备份并校验目标路径；CLI不自动改实际配置或切换服务。词表预置仅“开发示意”，正式分类由维护者确认后追加。重置撤销全部旧会话，不自动启用停用账号；安全交接使用团队已有受控渠道，本模块不发送密码。

备份维护锁为数据库持久锁，覆盖新管理写入、旧 createRevision/submit/publish/unpublish/revokeMedia/initializeDevelopment/backup 和待执行迁移；过期也不自动放行。文件复制/核验期间禁止写入，只有备份收尾和显式离线恢复操作可处理锁。租约5分钟，超时保留锁及 running 状态待维护，不承诺无限大媒体库都能在租约内完成。

失败文件补偿仅删除本次 UUID 私有对象；删除失败/进程崩溃的孤儿仍不经路由开放。inspect-media 离线对账只输出计数，不删除任何文件；维护者先保存证据并核对台账再处理私有孤儿，不能按文件年龄自动清理。Windows ACL、容器/Job Object 的 native 内存/CPU 限额、HTTPS 和反向代理均须宿主集成验证，V8 heap 上限不是 native 内存限制。
