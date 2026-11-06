# 模块公开 API v1

从 `@shoushang/contracts` 导入类型及 schema，从各包公开入口导入实现。统一 `Result<T> = {ok:true,value:T} | {ok:false,error:ApiError}`。通过 ok 收窄后读取数据；禁止返回 null、空字符串或 undefined 来模糊错误与空结果。所有预期错误走结果类型；未知实现异常由适配器转换，不向页面泄漏堆栈。端口类型不含 DOM/Fastify/React。

## 内容端口

`ContentClient.mode: mock|http`；`listCrafts()`；`listTemplates(query?)` / `getTemplate(id)`；`listExhibits(query?)` / `getExhibit(id)`；`listStories(query?)` / `getStory(id)`；`getHome()`。列表返回 Page，工艺返回数组，首页返回 exhibits/stories。M01 列表暂复用详情 DTO；M12 引入摘要 DTO 时须总控处理契约，不能无记录缩减字段。

```ts
import { createMockContentClient } from '@shoushang/content-client';
const client = createMockContentClient('normal');
const result = await client.listExhibits({ q: '几何', page: 1 });
if (result.ok) console.log(result.value.items);
else console.error(result.error.code);
```

工厂场景 normal/empty/failure；empty 对列表是成功空数组、详情为 NOT_FOUND，failure 为 NETWORK_ERROR；normal 查询 missing ID 返回 NOT_FOUND。均无随机数。返回深复制，避免调用者污染 fixtures。示例数据加载时执行同一 Zod 校验。

M12 的 `createHttpContentClient(...): ContentClient` 必须实现同一端口，入参/响应均校验，query URL 编码，10秒超时、读取最多重试1次、请求取消/过期响应不覆盖新查询。M12 HTTP 工厂已实现并由本轮总控接入。公开路由为 `/api/v1/home|crafts|templates|exhibits|stories`（模板、展品、故事包含 /:id）。`/health` 使用 HealthSchema 仅报告服务存活，contentMode=http；`/ready` 使用 ReadinessSchema 实际读取数据库，ready 返回200，不可读返回503/not-ready。健康 DTO 变更见 CR-M12-02，不改变 ContentClient 方法签名或 Work。

## 剪纸命令与渲染

`PapercutCore.createState(work)`、`validate(work)`、`dispatch(state,command)` 返回 Result；command 判别 type 为 add-cut(operation) / undo / redo / set-palette(palette)。状态包含只读 work/undo/redo；实现不得原位变更。无效命令状态不变；历史至少30步、最多100个切口；撤销后新操作清空redo；颜色变化不清空切口。core 不分配时间/随机ID、不修改保存 revision；调用方在保存边界处理元数据。

`ArtworkRenderer.render({work,width,height,view:'folded'|'unfolded'})` → `{svg,width,height,rendererVersion:1}`。width/height 为正整数 CSS 逻辑像素，适配保持单位方纸比例并居中；SVG 自包含、无脚本或外链，不改写作品。缺少旧算法版本返回 UNSUPPORTED_VERSION，非法几何返回 GEOMETRY_INVALID。M01 仅接口，没有假渲染。

## 本地仓储

M09 包级公开扩展：`IndexedDbRepository.renameWork({workId,name,expectedWorkRevision,expectedDraftRevision})` 返回 `{work,draft}`，`deleteWork({workId,expectedWorkRevision,expectedDraftRevision})` 返回 `{workId}`。两种 expected 值均必须给出；`null` 表示确认时该版本不存在，不能忽略检查。事务内任一版本新增、消失或修订改变则 `REVISION_CONFLICT`，不写入。改名同时保留完成版和草稿各自内容，推进两者修订及草稿基线；若原草稿基线已落后则冲突。完成版缩略图转 pending，调用方按新修订重建。删除原子移除两版本和缩略图，保留草稿修订高水位。原端口和现有方法不变；数据库物理版本仍为 3。

`LocalRepository.persistence: memory|indexeddb`；list({status?,page?,pageSize?}) 按更新时间倒序、同时间按id；read(id)；save({work,expectedRevision})；delete(id,expectedRevision)。成功返回保存后的 Work（含实际 revision/时间）；删除成功 `{id}`。保存/删除预期失败类型为 StorageFailure 判别联合。

新作品 work.revision=0、expectedRevision=null 表示仅创建；已存在返回冲突。更新时 work.revision 与 expectedRevision 都应等于当前修订，成功原子递增1；createdAt 保持原值，updatedAt 由仓储注入时钟。目标消失但预期更新也为冲突 actualRevision=null，不能当新建覆盖。只有成功结果可提示已保存。revision 冲突带 expectedRevision/actualRevision，保留内存并提示另存副本，不重试覆盖。删除缺失为 NOT_FOUND，不冒充已删除；保存重试遇冲突先读取确认，不盲目再创建新ID。

`createMemoryRepository({failure?,maxWorks?,now?})` 仅测试。failure 是 STORAGE_UNAVAILABLE 或 QUOTA_EXCEEDED，前者所有操作失败、后者只阻止写入；数量默认100，已满仍允许读取、删除和更新。返回/存入均深复制；容量/冲突失败不改已有记录。每工厂实例独立，刷新后丢失。IndexedDB、缩略图事务、收藏与迁移由 M05 实现。

`FavoriteRepository.list/put/remove` 已定义：put 同展品幂等，收藏不存在的下架引用仍保留ID以允许删除。M01 未实现，不展示收藏完成。

## 作品卡导出

`ArtworkExporter.exportCard({work,width?,height?})` → Promise<Result<{bytes:Uint8Array,mimeType:'image/png',filename,width,height}>>。默认1600×2000像素，宽高为正整数、sRGB、不透明背景；实现限制最大尺寸以控制内存。复用 renderer 的 unfolded SVG 再 Canvas 合成；作品名、工艺、保存日期（Asia/Shanghai）、数字体验说明、产品署名；不能引入另一套几何。字体/资源未就绪返回 RESOURCE_UNAVAILABLE，生成失败 EXPORT_FAILED，不触发假下载成功。调用方接 bytes 创建 Blob 并释放 URL，文案“作品卡已生成”；下载触发不等于已存入设备。M01 只有接口。

## 错误语义与 HTTP 映射

| code | 意义 / 行动 | HTTP |
| --- | --- | --- |
| INVALID_INPUT | 格式/参数错；显示 fieldErrors 让用户修改 | 400 |
| UNAUTHENTICATED | 无有效后台会话，转登录 | 401 |
| FORBIDDEN | 已识别身份但无权限，不能靠隐藏菜单替代 | 403 |
| NOT_FOUND | 内容不存在、未发布、已下架统一不可用；本地作品缺失 | 404 |
| REVISION_CONFLICT | 不覆盖；保留当前内容并另存副本或重新载入 | 409 |
| STORAGE_UNAVAILABLE | 浏览器拒绝/不支持/无法打开存储；保留内存并可导出 | 本地错误，不伪装HTTP |
| QUOTA_EXCEEDED | 存储或作品数达限；释放空间、删除后重试；已有作品可读 | 本地错误 |
| NETWORK_ERROR | 断网/连接失败/不可解析响应；保留条件后重试 | 传输错误，无虚构status |
| TIMEOUT / ABORTED | 超过10秒 / 主动取消；取消不显示普通失败 | 传输错误 |
| INTERNAL_ERROR | 服务异常，给请求ID，内部记录详情 | 500 |
| PAYLOAD_TOO_LARGE / RATE_LIMITED | 上传过大 / 频率受限 | 413 / 429 |
| UNSUPPORTED_VERSION | 不能恢复版本，不清空原记录，提示备份 | 模块错误 |
| GEOMETRY_INVALID | 几何不适合剪切，历史不变、说明原因 | 模块错误 |
| RESOURCE_UNAVAILABLE / EXPORT_FAILED | 缺渲染资源或导出失败，可重试且不改作品 | 模块错误 |

ApiError 始终有 requestId、fieldErrors（可空）。本地/mock 使用标识测试请求的固定ID；真实服务每请求生成关联ID，不暴露管理字段。M12/M13 在服务端强制权限、发布过滤和响应白名单，M01 不宣称已实现权限。

## M04正式core接入

`@shoushang/papercut-core`公开`createPapercutCore()`（兼容PapercutCore端口）、原有命令/状态/错误类型及Work/CutOperation/TemplateVersion/Result类型。createState/validate/dispatch均在运行时校验输入，错误包含字段路径。createState不生成时间或ID；传入已有Work，成功后得到独立快照。validate成功也返回独立、经过schema规范化的Work。

```ts
import { createPapercutCore, getWorkGeometry } from '@shoushang/papercut-core';
const core = createPapercutCore();
const checked = core.validate(work); // M05读入/恢复边界；失败保留原记录
const initial = core.createState(work); // 新作品、重新打开或模板切换，清空历史
if (initial.ok) {
  const result = core.dispatch(initial.value, { type: 'add-cut', operation });
  // operation的id/order、Work的时间与保存元数据由调用方提供
}
const geometry = getWorkGeometry(work); // M06使用原始形状、定位及对称矩阵
```

M05保存成功后可用`{...state, work: savedWork}`保留编辑历史；作品id/craftId与完整模板快照必须相同。undo/redo只恢复operations/palette，不回退名称、revision、时间等元数据。更换模板须createState，不拼接历史。`getWorkGeometry`输入unknown并返回Result，曲线数据与保守校验轮廓分离；精确类型、坐标和组合顺序见[算法v1](../algorithms/papercut-v1.md)。M06不需要重新推导控制点，不使用保守点集合代替原曲线；SVG实例隔离仍由M06设计。

## M05 IndexedDB 扩展

`openIndexedDbRepository(options?)` 返回 `Result<IndexedDbRepository,StorageFailure>`，成功实例的 `persistence='indexeddb'`，调用方在卸载时 `close()`。实例保留旧 `LocalRepository` 方法，另有 `favorites`、`saveWithThumbnail`、`saveDraft/readDraft/listDrafts/discardDraft/commitDraft`、`readThumbnail/rebuildThumbnail`、`inspectRecords/exportRawBackup`。`save` 等价于没有预制图片的 `saveWithThumbnail`，原子写 pending 缩略图。草稿的 `revision` 与 `baseRevision` 分别保护草稿并发和所依据完成版；`step` 为编辑会话数据。`inspectRecords` 须与列表一起用于损坏记录提示；`exportRawBackup` 返回原始结构化数据（含 Blob），调用方下载 JSON 时需将 Blob 转为 data URL。细节见[存储设计](../storage/indexeddb-v1.md)。

M05 复审后，草稿 revision 对同一 workId 在删除、提交、重建之后仍递增；它不承诺首次从 1 开始。三个编辑方法继续以调用方持有的草稿 revision 为事务内并发条件，过期值返回 `REVISION_CONFLICT`，不会影响新草稿。

## M13 管理服务端口（2026-10-19）

实现入口 apps/api/src/admin/index.ts：`adminRoutes(app,{database,origin,securityMode,listenHost,mediaRoot,backupRoot})`，宿主仍唯一拥有 ContentDatabase/close。生产 securityMode=https，Origin 必须 HTTPS；显式 loopback-http 同时要求回环 Origin、listenHost 和实际监听地址，宿主 listen 后调用 `assertAdminListener`，模块逐管理请求再次核验。挂载与全局路由仍由后续总控处理。

`database.admin` 提供受控账号维护、会话/挑战/限流、contents/content/history/vocabulary、save/submit/review/publish/unpublish/restore、stageMedia/license/proof/reviewMedia/revokeMedia/mediaFile、audits/accounts/disable、queueBackup/backupStatus/startBackup/backupSnapshot/finishBackup 和明确离线维护方法。管理写入参数 Access 包含服务端令牌摘要和 requestId，不接受请求体 actor/role；身份与角色在 BEGIN IMMEDIATE 内重验。没有公共 SQL/连接/通用事务回调。

HTTP 基础路径 /api/v1/admin。页面及客户端入口在 apps/web/src/features/admin/index.ts：AdminPage、createAdminHttpClient、AdminHttpError；客户端同源 Cookie + 内存 CSRF，不使用公开 ContentClient 写入。管理 JSON 成功/失败继续沿用 Result/ApiError envelope；注销204；新草稿/图片201；备份202仅接受任务。分页默认12/上限50。401会话无效、403权限或Origin/CSRF、409修订或幂等冲突必须保留表单，不盲覆盖/重试。

实际方法/路径、请求字段和返回值的完整清单见 apps/api/src/admin/README.md。媒体二进制上传不引入 multipart；普通管理请求256KiB、图片5MiB。公开图片 /api/v1/media/:id/original|thumbnail 逐次核验 approved、当前公开引用、工艺可见性、撤权和文件哈希，无静态目录。proof 只走鉴权后台入口，上传者或管理员可读，内部许可 URL 不投影公开 DTO。

publish/unpublish/restore/disable/revoke/backup 用 Idempotency-Key（16～128字母数字下划线短横线）；同 actor/op/key 同规范请求重放已提交结果，异请求409。发布同时检查 expectedLatest、expectedPublic（含null）、当前待审修订和审核绑定。历史恢复生成新草稿，不能原位修改历史或复活撤权媒体。精确 API 参数和已有 ContentClient/Work 无不兼容变化。

M13幂等补充：已受理的业务拒绝通过内部SAVEPOINT撤销操作后，在同一外层事务保存拒绝结果与失败审计，重启后同键同请求仍重放拒绝，同键异请求409。内部存储故障不伪造持久结果；语法或身份验证失败发生在受理之前。最终验证与未验证的部署边界见M13交接。


## M13 审核退回修复（2026-10-19）

发布只接受当前修订最新审核的 reviewId，且结论为 approved；旧通过之后出现退回或新通过，旧 reviewId 均返回 INVALID_INPUT (400)。审核与发布在 BEGIN IMMEDIATE 中串行判定。前端管理 client.call 第四参可为显式操作键；每次确认弹窗生成新键，原弹窗失败重试沿用，取消后重开为新操作。自动 true 模式仅在确认成功或合法4xx响应后释放键；传输/5xx/解析失败保留。

## M14-2A 内部公开读取版本

ContentDatabase新增 `readPublicSnapshotSince(knownVersion?: string)` → `{version, snapshot}`；snapshot为原readPublicSnapshot结果或null（仅传入版本与当前同实例版本相同）。调用方持有的旧快照必须与该token绑定；没有可复用值时不得用null伪造空集。版本检查和必要的行/撤权集合读取同一已钉住SQLite读事务，覆盖本连接total_changes与外部连接data_version变化，不使用TTL。原readPublicSnapshot、M12写入、database.admin事务不变。

PublicContentService的内部公开快照仅供私有查询方法读取，所有对外方法返回独立副本；snapshot仍返回完整公开结构。单服务保留一份，原公开行≤10000且公开JSON UTF-8≤8MiB；超限不保留而非返回空/截断。每次请求仍校验查询参数、检查数据库版本；关闭/读取错误继续失败，不回退缓存。HTTP的requestId/no-store/错误与公开字段不变。没有迁移或新增生产依赖。

兼容读取边界：`readPublicSnapshot()`无参仍完整返回原始公开读取；新增内部重载`readPublicSnapshot(knownVersion: string | undefined)`返回上述带版本结果，`readPublicSnapshotSince`显式委托此重载。两条路径均经过原受控读取/故障边界；原应用测试注入读取故障时，即使命中缓存也保持公开500与ready503，不返回旧缓存成功。
