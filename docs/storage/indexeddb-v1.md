# M05 IndexedDB v1 存储设计基线

2026-10-17 技术实现基线；未声称人工评审或已发布历史版本。

## 物理结构与版本

默认数据库 `shoushang-local-v1`，当前物理版本 3。可注入数据库名供隔离测试。物理版本 1 **仅用于迁移演练的测试格式**，不是已发布用户数据；含 `m05-test-legacy-works`（`{id,work}`）和 `m05-test-legacy-favorites`（`{exhibitId,favorite}`）。仅识别这两个 store 且没有其他 store 时，升级事务验证后复制到新 store；任何坏记录使升级整体回滚，原测试库仍为 v1。物理版本 2 是本阶段先前的开发布局；升级到 v3 保留已有作品与草稿，并提高在库草稿修订，使旧标签页持有的 v2 修订失效。`works` 以 `id` 为键，值为完整已保存 `Work`，索引 `updatedAt` 只用于将来优化；`drafts` 以 `workId` 为键，值含 `work`、`step`、`revision`、`baseRevision`、时间；`draftRevisions` 以 `workId` 为键，值含该 ID 已分配的最高草稿修订；`thumbnails` 以 `workId` 为键，值含 `workRevision`、`state: ready|pending` 和可选 Blob；`favorites` 以 `exhibitId` 为键，仅存 `Favorite` 引用。作品操作、名称、模板快照、配色均在完整 Work 中，缩略图不复制作品。所有值使用 IndexedDB 结构化克隆。

`Work.schemaVersion=1` 定义作品数据格式；数据库物理版本定义 store 布局；`templateSnapshot.version` 定义内容模板的不可变版本；`Work.revision` 是完成作品的乐观并发号。草稿另有 `revision`，其 `baseRevision` 是编辑开始时完成作品的修订。四者不可混用。没有已发布旧版数据库；新建库直接创建物理 v3。未来只迁移明确支持的格式，升级事务失败回滚；未知更高数据库版本不删除重建。测试夹具模拟旧格式时必须标为测试。

## 端口与流程

保留 `LocalRepository`、`FavoriteRepository`、`Work`、`SaveWorkInput` 不变。公开扩展提供 `saveWithThumbnail`、`saveDraft/readDraft/listDrafts/discardDraft/commitDraft`、`readThumbnail/rebuildThumbnail`、`inspectRecords/exportRawBackup` 和 `close`，工厂返回 `persistence='indexeddb'`。普通 `save` 等价于缩略图状态 `pending` 的原子保存，不保留旧图为最新。Blob 由调用方在事务外准备；M06 尚未提供正式渲染，验证页图片为自制测试图。页面的 1 秒自动保存调度由 M07 负责。

新作品先 `saveDraft`，占一个名额；明确完成保存用 `commitDraft`，同事务写完成版、ready/pending 缩略图并删除草稿。旧端口 `save` 仍接受合法 Work 的 draft/completed 状态，但它写主记录，不承担编辑会话自动保存；M07 必须用 `saveDraft` 编辑已有完成版。直接 `save/saveWithThumbnail` 同事务清除关联草稿，防止旧草稿覆盖新版本。取消编辑用 `discardDraft`；删除完成版用 `delete`，同时移除草稿和缩略图。只有草稿的新作品可通过 `discardDraft` 删除。恢复先校验结构、版本与 M04 几何，并返回步骤；异常记录仍可导出原始备份。

已完成作品和同 ID 草稿共占一个名额；无完成版的新草稿也占一个名额。限制 100 个不同 workId，收藏和 `draftRevisions` 高水位记录不占名额。计数包括损坏作品/草稿记录的键，避免以损坏记录绕过限制。普通 `list` 只返回可用 Work；`inspectRecords` 列出损坏/不兼容明细、键与原因，页面必须同时调用并提示，不可把单条错误当空库或静默隐藏。`read` 某个损坏记录返回 `INVALID_INPUT` 或 `UNSUPPORTED_VERSION`。`exportRawBackup` 返回原始结构化数据；验证页下载 JSON 时将 Blob 编成 data URL，保留图片字节。备份不是任意文件导入入口。

## 原子性、时间和错误

所有读取当前修订、expectedRevision 比较、不同 ID 数量检查及写入在同一适当范围的 `readwrite` 事务中；草稿保存额外包含 `draftRevisions`。请求成功仍等待事务 `complete` 才返回成功；`abort/error` 返回错误。两个标签页同一 ID 更新只允许一个提交。`expectedRevision=null` 仅新建、首次完成版 revision=1；更新必须匹配，删除后的旧更新返回冲突 `actualRevision=null`。草稿写入另比较自身 revision 和 baseRevision；提交还须匹配当前完成版。草稿删除、提交和作品删除都保留该 ID 的高水位，因此同 ID 重建草稿不会复用旧修订。新草稿修订以当前毫秒数作下限种子，用于让物理 v2 中已经删除、无记录可迁移的旧草稿修订失效；它不承诺从 1 开始。若设备时间回拨，高水位仍保证递增。冲突不覆盖或换 ID。通知仅作 UI 提示，不参与正确性。

时钟可注入；更新时间取 `max(now, createdAt, previous.updatedAt + 1ms)`，避免设备时间回拨而使合法编辑失败。`createdAt` 更新时保留原值。时间异常、结构/几何不合法返回 `INVALID_INPUT` 并带字段路径；未知版本返回 `UNSUPPORTED_VERSION`；打开失败、权限拒绝、升级阻塞或连接关闭返回 `STORAGE_UNAVAILABLE`；浏览器真实配额或 100 件上限返回 `QUOTA_EXCEEDED`。不泄漏底层异常堆栈。关闭连接后方法返回不可用；`versionchange` 自动关闭并通知回调。升级被别的标签阻塞时在有限超时内结束本次打开，调用方可关闭旧标签后重试。

缩略图的 `workRevision` 必须与完成版修订相同。新保存未提供 Blob 则原子写 `pending`，不能把旧图标为最新。`rebuildThumbnail` 仅在当前完成版修订仍等于生成时修订时写入，否则冲突，旧异步任务不能回写。缩略图 Blob 数据和作品同事务提交；失败不损坏旧完成版。事务内不等待渲染、网络或其他异步工作。

收藏以 exhibitId 唯一，重复 put 保留首次 createdAt，remove 不存在的引用也成功且幂等；只存引用，不查询远端是否下架。所有读写结果与调用方入参隔离。
