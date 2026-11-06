# M05 IndexedDB v1 存储设计基线

2026-10-17 技术实现基线；未声称人工评审或已发布历史版本。

## 物理结构与版本

默认数据库 `shoushang-local-v1`，当前物理版本 3。可注入数据库名供隔离测试。物理版本 1 **仅用于迁移演练的测试格式**，不是已发布用户数据；含 `m05-test-legacy-works`（`{id,work}`）和 `m05-test-legacy-favorites`（`{exhibitId,favorite}`）。仅识别这两个 store 且没有其他 store 时，升级事务验证后复制到新 store；任何坏记录使升级整体回滚，原测试库仍为 v1。物理版本 2 是本阶段先前的开发布局；升级到 v3 保留已有作品与草稿，并提高在库草稿修订，使旧标签页持有的 v2 修订失效。`works` 以 `id` 为键，值为完整已保存 `Work`，索引 `updatedAt` 只用于将来优化；`drafts` 以 `workId` 为键，值含 `work`、`step`、`revision`、`baseRevision`、时间；`draftRevisions` 以 `workId` 为键，值含该 ID 已分配的最高草稿修订；`thumbnails` 以 `workId` 为键，值含 `workRevision`、`state: ready|pending` 和可选 Blob；`favorites` 以 `exhibitId` 为键，仅存 `Favorite` 引用。作品操作、名称、模板快照、配色均在完整 Work 中，缩略图不复制作品。所有值使用 IndexedDB 结构化克隆。

`Work.schemaVersion=1` 定义作品数据格式；数据库物理版本定义 store 布局；`templateSnapshot.version` 定义内容模板的不可变版本；`Work.revision` 是完成作品的乐观并发号。草稿另有 `revision`，其 `baseRevision` 是编辑开始时完成作品的修订。四者不可混用。没有已发布旧版数据库；新建库直接创建物理 v3。未来只迁移明确支持的格式，升级事务失败回滚；未知更高数据库版本不删除重建。测试夹具模拟旧格式时必须标为测试。

## 端口与流程

M09 管理扩展在现有物理 v3 store 上增加包级 `renameWork` 与 `deleteWork`，不新增 store 或迁移。调用方必须传完成版和草稿两个预期修订，`null` 严格表示不存在。改名在同一事务中核对后只更新名称、时间和必要修订元数据，完成版缩略图置 pending；旧草稿基线不匹配时拒绝，不能借改名消除编辑冲突。删除在同一事务中核对后移除 works、drafts、thumbnails，保留 draftRevisions。原有 `save/saveWithThumbnail/delete` 不改变，管理页不得调用它们模拟安全改名或整件删除。

保留 `LocalRepository`、`FavoriteRepository`、`Work`、`SaveWorkInput` 不变。公开扩展提供 `saveWithThumbnail`、`saveDraft/readDraft/listDrafts/discardDraft/commitDraft`、`readThumbnail/rebuildThumbnail`、`inspectRecords/exportRawBackup` 和 `close`，工厂返回 `persistence='indexeddb'`。普通 `save` 等价于缩略图状态 `pending` 的原子保存，不保留旧图为最新。Blob 由调用方在事务外准备；M06 尚未提供正式渲染，验证页图片为自制测试图。页面的 1 秒自动保存调度由 M07 负责。

新作品先 `saveDraft`，占一个名额；明确完成保存用 `commitDraft`，同事务写完成版、ready/pending 缩略图并删除草稿。旧端口 `save` 仍接受合法 Work 的 draft/completed 状态，但它写主记录，不承担编辑会话自动保存；M07 必须用 `saveDraft` 编辑已有完成版。直接 `save/saveWithThumbnail` 同事务清除关联草稿，防止旧草稿覆盖新版本。取消编辑用 `discardDraft`；删除完成版用 `delete`，同时移除草稿和缩略图。只有草稿的新作品可通过 `discardDraft` 删除。恢复先校验结构、版本与 M04 几何，并返回步骤；异常记录仍可导出原始备份。

已完成作品和同 ID 草稿共占一个名额；无完成版的新草稿也占一个名额。限制 100 个不同 workId，收藏和 `draftRevisions` 高水位记录不占名额。计数包括损坏作品/草稿记录的键，避免以损坏记录绕过限制。普通 `list` 只返回可用 Work；`inspectRecords` 列出损坏/不兼容明细、键与原因，页面必须同时调用并提示，不可把单条错误当空库或静默隐藏。`read` 某个损坏记录返回 `INVALID_INPUT` 或 `UNSUPPORTED_VERSION`。`exportRawBackup` 返回原始结构化数据；验证页下载 JSON 时将 Blob 编成 data URL，保留图片字节。备份不是任意文件导入入口。

## 原子性、时间和错误

所有读取当前修订、expectedRevision 比较、不同 ID 数量检查及写入在同一适当范围的 `readwrite` 事务中；草稿保存额外包含 `draftRevisions`。请求成功仍等待事务 `complete` 才返回成功；`abort/error` 返回错误。两个标签页同一 ID 更新只允许一个提交。`expectedRevision=null` 仅新建、首次完成版 revision=1；更新必须匹配，删除后的旧更新返回冲突 `actualRevision=null`。草稿写入另比较自身 revision 和 baseRevision；提交还须匹配当前完成版。草稿删除、提交和作品删除都保留该 ID 的高水位，因此同 ID 重建草稿不会复用旧修订。新草稿修订以当前毫秒数作下限种子，用于让物理 v2 中已经删除、无记录可迁移的旧草稿修订失效；它不承诺从 1 开始。若设备时间回拨，高水位仍保证递增。冲突不覆盖或换 ID。通知仅作 UI 提示，不参与正确性。

时钟可注入；更新时间取 `max(now, createdAt, previous.updatedAt + 1ms)`，避免设备时间回拨而使合法编辑失败。`createdAt` 更新时保留原值。时间异常、结构/几何不合法返回 `INVALID_INPUT` 并带字段路径；未知版本返回 `UNSUPPORTED_VERSION`；打开失败、权限拒绝、升级阻塞或连接关闭返回 `STORAGE_UNAVAILABLE`；浏览器真实配额或 100 件上限返回 `QUOTA_EXCEEDED`。不泄漏底层异常堆栈。关闭连接后方法返回不可用；`versionchange` 自动关闭并通知回调。升级被别的标签阻塞时在有限超时内结束本次打开，调用方可关闭旧标签后重试。

缩略图的 `workRevision` 必须与完成版修订相同。新保存未提供 Blob 则原子写 `pending`，不能把旧图标为最新。`rebuildThumbnail` 仅在当前完成版修订仍等于生成时修订时写入，否则冲突，旧异步任务不能回写。缩略图 Blob 数据和作品同事务提交；失败不损坏旧完成版。事务内不等待渲染、网络或其他异步工作。

收藏以 exhibitId 唯一，重复 put 保留首次 createdAt，remove 不存在的引用也成功且幂等；只存引用，不查询远端是否下架。所有读写结果与调用方入参隔离。

## M15-6A 校验边界

M15-6A 仅新增独立的 v1/v2 存储前校验：v1 继续复用既有 core 语义；v2 在恢复或新建/另存前校验严格 schema、core 几何、唯一 profile 注册项、完整 profile 快照以及模板 RFC 8785/JCS UTF-8 SHA-256。profile 生命周期不参与不可变快照深值比较；停用仅阻止新建/另存，历史恢复按 `editable` 或 `read-export-only` 返回访问模式。本阶段未接入 IndexedDB 事务，未修改物理版本、store 或 index，也未实现真实读写、迁移和页面接线。

## M15-6B 共存只读接入

物理数据库仍为 `shoushang-local-v1` v3，原有五个 store 与 index 不变；`works` 和 `drafts` 可直接共存 v1/v2。新增 `readAnyWork/listAnyWorks/readAnyDraft/listAnyDrafts` 在只读事务完成并取得结构化克隆后，才在事务外执行 M15-6A 的 profile、几何和异步摘要校验；列表先过滤合法记录再计算 `total` 与分页，单条坏记录保留供 `inspectRecords` 和 `exportRawBackup` 检查。旧 v1 接口语义不变；通用读取遇到 v2 但未配置 profile 注册表时明确失败。本阶段不提供 v2 写入、v1→v2 迁移或页面接线。

## M15-6C v2 原子写入

新增独立的 `saveV2WithThumbnail/saveV2Draft/commitV2Draft/discardV2Draft/readAnyThumbnail/rebuildV2Thumbnail`，旧 v1 接口不变。v2 schema、几何、profile 深值、模板摘要和生命周期均在 readwrite 事务前校验；更新先取得只读快照，事务内再按完整快照、schemaVersion 和 revision 复核。作品、草稿、高水位和缩略图继续共用物理 v3 的既有 store，成功仅在 transaction complete 后返回；停用 profile 只拒绝新建，`read-export-only` 禁止创作写入但允许读取和重建当前 revision 的缩略图。本阶段仍不实现 v1→v2 另存迁移、profile 自动选择或页面接线。

## M15-6D v1 另存 v2

新增 `saveV1AsV2`：严格读取 v1 源记录，以其模板 id、version 和 JCS SHA-256 在注册表中唯一匹配启用的 profile，把参数切口逐字段转换为 v2 parametric 操作，并调用完整 v2 校验。随后在单个 readwrite 事务中复核源 revision 与完整签名、新 ID create-only 和统一 100 件限额，再原子写入 v2 草稿及高水位，或完成版及 ready/pending 缩略图；源 v1 作品、草稿、缩略图和 revision 均不改。数据库仍为物理 v3，store/index 不变；页面接线不在本阶段。

## M15-6D2 v1 独立草稿另存 v2

新增 `saveV1DraftAsV2`：只读取源 `drafts` 中的合法 v1 草稿，以草稿的 `work`（名称、配色、操作、模板快照、步骤）转换，绝不使用同 ID 完成版代替。事务前完成严格校验、唯一启用 profile 的模板 id/version/JCS SHA-256 匹配、参数切口转 v2 parametric 和完整 v2 校验，并保存源草稿及存在时同 ID 完成版的完整签名；单个 readwrite 事务复核草稿/完成版 revision 与签名、`baseRevision`、新 ID create-only 和 100 件上限，仅原子写目标 `drafts` 与 `draftRevisions`，源记录、源缩略图和高水位不变。数据库仍为物理 v3，store/index 不变。
