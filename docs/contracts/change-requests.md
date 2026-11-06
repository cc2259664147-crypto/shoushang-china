# 公共契约变更请求

## CR-V1-PUBLIC-MEDIA-01：后台关闭时的受控公开媒体（2026-10-23）

独立包初始化后默认关闭后台，原媒体路由随后台一起卸载，导致展馆与故事图片不可读。新增只读公开媒体插件：后台关闭时可单独设置项目外绝对 `ADMIN_MEDIA_ROOT`，不要求启用后台、Origin或备份配置；已启用后台的行为不变。沿用 `/api/v1/media/:id/original|thumbnail`、公开引用与撤权校验、读盘前后两次授权、内容hash和no-store，公开路径不支持proof、不挂载账号/会话/上传/备份。未配置媒体根时保持旧行为。数据库/媒体根不许置于源码树或相互嵌套；无SQL迁移和公开DTO变化。公开许可不等于真人签字，所有后台受控入口和CSRF保持。

兼容：原后台部署配置无需修改；仅访客演示新增媒体根配置。回归覆盖后台404、未引用媒体/下架/撤权404、损坏hash500和私有路径不可访问。

## V1开发工具安全修订（2026-10-23）

根据本轮审计与注册表兼容要求，将根与原型的Vitest精确锁为4.1.12、concurrently精确锁为9.2.5并更新锁文件，消除旧Vitest/mocker/tinypool及shell-quote工具链公告；未执行audit fix或批量升级生产依赖。Node24.19/Vite7兼容范围匹配，最终类型、215项和构建回归另存本轮证据。此步骤无业务数据迁移，当时运行库为Fastify5.12.5/sharp0.35.5；后续安全补丁见 CR-V1-FASTIFY-01。

## CR-V1-FASTIFY-01：Fastify安全补丁

2026-10-23最终冻结审计发现 `GHSA-389g-gv7q-r4x8` 影响Fastify `>=5.12.2 <5.12.6`，生产API可达，因此将直接依赖精确升级为5.12.6并冻结锁文件。公共HTTP契约、数据结构和数据库均不变，不需要内容或用户数据迁移；兼容方案是继续使用Fastify5同一小版本API，并以现有API、初始化、后台安全与独立包浏览器回归验证。未执行`audit fix`，未升级sharp或其他无关依赖。

## CR-V1-CONTENT-INIT-01：版本化交付内容初始化（2026-10-22）

M14-6 压缩包只有开发示意模板，无法在全新私有目录复现 3 模板、12 展品、3 故事。`ContentDatabase` 新增 `initializeBaseContent(name, dataset)`：只允许显式 `v1-*` 版本名、全新空库、一个 `craft-papercut` 工艺和三个 `template-v1-*` 模板。展品、故事和媒体仍必须经过鉴权后台 HTTP 的上传、许可、提交、技术审核和发布入口。

这是新增方法，不改变既有 `initializeDevelopment`、正常启动、公开 DTO 或 HTTP 契约；普通启动不会调用。既有库不迁移也不覆盖，同一已完成批次重复执行只返回未改动，其他非空库拒绝。初始化审核记录必须写明“自动化技术核对”，不代表真人编辑、法务批准或比赛授权。

2026-10-23 安全收尾：正式内容输入为 `content/v1-initial-2026-10-22/records.json`，原件与上传件在创建私有目录前校验；相对路径、项目内路径、重复候选或断裂媒体映射拒绝。数据库封装的“空库”包含账号、媒体、维护历史和自定义词表，避免仅凭公开内容为空而接管既有库；同批次调用仍不写已有修订。完成回执升级为私有 schemaVersion=2，保存来源指纹、服务生成 ID 映射与已初始化数据指纹。重复 CLI 只读打开 SQLite，不迁移；核对实际 ID、修订、发布状态、许可台账和原图/缩略图/私有技术记录哈希；发现后续维护或损坏明确拒绝并保留原样。旧 schemaVersion=1 回执不自动升级或重灌，须保留原目录并使用新的空目录。HTTP 初始化失败先注销已建会话、停止本轮服务，再通过既有恢复隔离封装停用临时账号与撤销会话；失败回执保留诊断和新空目录重试方式。没有新增正常启动副作用或正式业务表 SQL 写入口。

## CR-M14-CONTENT-MEDIA-01：公开媒体来源与修改说明（2026-10-21，总控定向授权）

M14-4独立复审发现正常详情页缺少已保存的媒体许可链接和修改说明。总控用户定向授权修复公开投影及页面。公共 `Media`增加可选 `source` 和 `modification`，并复用既有 `License.url`；旧 fixture 和未登记该字段的旧内容保持兼容，无数据时不生成虚构文字。

后台公开投影只从受控媒体许可台账输出 `source`、`licenseUrl` 和 `modification`，不输出 `proofRef`、对象存储键、内部路径、凭据或会话数据。Gallery 和 Stories 详情页条件显示这些字段。契约边界、公开 DTO 泄漏与正常页面测试同步覆盖。本变更不表示许可经人工或法律审批，也不改变正式发布门禁。

## CR-M12-02：总控健康/就绪接入（2026-10-19）

用户授权本轮总控接入时实施。原 HealthSchema 固定 contentMode=mock、database=not-initialized，与真实内容接入冲突。最小变更：/health 的 HealthSchema 保留 status=ok/service/version，contentMode 改为 http，移除 database（仅存活）；新增 ReadinessSchema，/ready 以 status=ready、database=ready 返回200，以 status=not-ready、database=unavailable 返回503，两者 contentMode=http。严格对象不含路径、SQL、凭据或堆栈。就绪仅证明数据库可读，不证明文化事实、媒体授权或生产配置验收。

这是健康诊断 DTO 的不兼容更新，旧 mock/not-initialized 消费者需同步更新；影响 API 挂载、工程说明、诊断测试、代理及运维探针。前端内容端口、Work 和其他业务 DTO 不变，无数据迁移。总控在本轮同步更新 schema、测试和文档；部署探针应区分 /health 与 /ready。请求级取消 CR-M12-01 不在本轮实施。

## M09 包级作品管理扩展（2026-10-18）

总控授权在 `@shoushang/local-repository` 的 `IndexedDbRepository` 增加 `renameWork`、`deleteWork`；`LocalRepository`、Work/StorageFailure contracts 和原有 `save/delete` 语义不变。两方法均把 `expectedWorkRevision` 与 `expectedDraftRevision` 的 `null` 解释为预期不存在，在同一 IndexedDB 事务中核对。改名统一更新同 ID 完成版与编辑草稿的名称、各自修订和时间；草稿 `baseRevision` 仅在原值等于当前完成版修订时随完成版推进，否则冲突。完成版缩略图标记 pending，保留草稿修订高水位。删除同时删除完成版、草稿和缩略图，保留高水位。无 store 结构变化，数据库物理版本保持 3。真实 Edge 回归覆盖双标签冲突及新增草稿与高水位。此处记录实现与兼容性，不代表人工审核签字。

## M05 本地仓储扩展决定（2026-10-17）

现有 `LocalRepository`、`FavoriteRepository`、`Work`、`SaveWorkInput` 保持不变，避免 M04/M07/M09 既有类型受影响。独立草稿步骤与基于完成版的修订、缩略图 Blob 与状态、恢复扫描和连接生命周期仅属于浏览器存储适配器，定义在 `@shoushang/local-repository` 公开入口。原端口 `save` 仍接受合法 draft/completed Work，写主记录并将缩略图置 pending；M07 编辑已完成作品必须调用独立 `saveDraft`，明确提交才调用 `commitDraft`。这不引入公共 DTO 迁移；首次发布没有历史正式物理格式。技术基线见 `docs/storage/indexeddb-v1.md`，未虚构审核签字。

M01交接时无待处理变更；M02待评审提案见下。模块会话只追加提案，不自行改 contracts。

提案模板：编号、提出模块、原因、旧字段/新字段、受影响模块、旧作品兼容/迁移、测试样例、总控决定及日期。

M01 决策：公开内容使用严格 allowlist DTO；不在公共模型加入后台草稿、passwordHash、proofRef；模板快照内置完整几何与算法版本。未来管理模型由服务端另行定义并显式转换公开 DTO。

## CR-M02-01：geometryVersion=1 算法冻结语义（待总控评审）

提出模块：M02，2026-10-17。没有必须新增的DTO字段，现有公开Work/TemplateVersion/CutOperation和三个模块端口已足够实现隔离验证；本次未修改contracts。

需要冻结的内容：水滴两段三次贝塞尔控制点；基础域的确定；minEdgeGap只作用于真实纸边；凸/非凸allowedRegion支持范围；折叠边可触碰但不得跨越的规则；重叠切口取并集；曲线保守校验容差。具体候选公式和测试在 prototypes/papercut-verification/ALGORITHM.md、src/core.test.ts。M02只验证方纸+vertical及radial4无镜像，不把未支持组合当已支持。

受影响：M04、M06、M08及未来M05历史作品兼容。旧字段/新字段：均不变；建议先冻结文档与黄金样例，再发布geometryVersion=1持久作品。如果公式不被接受，应在正式发布前替换原型并重验，而非悄悄改变既有作品。正式发布后改变几何须新版本或经像素验证的迁移，保留旧渲染分支。总控决定：待评审，未擅自通过。

## CR-M02-02：命令历史与渲染实例标识（待总控评审）

建议冻结配色参与撤销、空撤销重做成功无操作、相同配色不清空redo；当前PapercutCommand无需增加字段。重命名不在该端口，原型将其视为界面元数据修改，不作剪切历史单元，正式元数据/时间由保存边界处理。多份内联SVG必须隔离资源ID；本原型用work.id+view区分两个实例，同作品同view重复挂载的通用实例隔离尚需M06设计（如调用方SVG图像隔离或实例前缀）。不要为解决DOM ID擅自改变作品几何。受影响M04/M06，兼容性：保存格式不变，测试需覆盖同屏折叠/展开、同作品多实例。总控决定：待评审。

## M04技术决定（2026-10-17）

CR-M02-01：**实现基线已确定，待阶段审核**。正式实现采用M02方纸、vertical和radial4无镜像的原公式，三形状原曲线及变换统一从core公开入口输出。控制点、支持矩阵、保守包络/误差/容差及版本策略见[算法v1](../algorithms/papercut-v1.md)。依据为正式core固定黄金样例和边界回归；不新增contracts字段，不依赖原型运行时代码。公共schema可表达的其他配置继续明确失败；未获得人工签字或正式发布批准。

CR-M02-02历史部分：**实现基线已确定，待阶段审核**。保留PapercutState的Work快照结构；只恢复operations/palette，当前名称、身份、模板、修订、时间和状态全部保留。两个方向各保留最近30步，空历史/相同配色不写历史或清redo。每次dispatch校验历史完整Work及同作品/完整模板身份；保存元数据变更后undo/redo回归已覆盖。无DTO迁移。SVG同作品同view多实例标识仍由M06负责，core不生成渲染ID；该部分未在M04关闭。

## CR-M13-01～03：管理后台扩展（2026-10-19，已获用户总控批准）

当前 M13 会话串行实施：同一 ContentDatabase/SQLite/迁移账本追加 v2；提供专用管理命令，不公开连接、SQL 或通用事务回调。不完整草稿留在不可变修订体系，发布完整校验并白名单投影；权限、账号状态、双头 CAS、幂等结果与成功审计同事务。新增账号/会话/限流、审核、媒体许可/凭证、备份任务和持久维护锁；维护锁覆盖旧写入入口，过期不自动解锁。公开 contracts/Work/ContentClient 不变，v1 SQL 不变。

批准精确运行依赖 sharp@0.34.5 及 API 构建 external，禁止无关升级。总控挂载仍留后续，不改 app.ts/server.ts/前端组合根。设计与安全边界详见 docs/handoffs/M13.md；实现后同步服务端端口与实际验证。本次授权范围为 admin/**、database/**、API清单/锁文件和三份契约说明，未包括重写公开内容服务。

### M13 后续定向授权与实际兼容调整

总控用户追加批准 sharp 精确版本调整为0.35.5；npm官方来源/Node>=20.9.0/Windows x64 原生包及许可核验后安装。0.34.5审计的3项high告警在0.35.5复审中相关条目为0，其余既有依赖不升级。Windows原生包声明Apache-2.0 AND LGPL-3.0-or-later，随包LICENSE及哈希列入独立证据，不能沿用旧版许可推断。

用户分别追加授权 content/content.test.ts 与 app.test.ts 中固定迁移版本断言的最小兼容调整：用当前 migrations.length 和下一连续版本替代写死的1/2，app测试临时连接增加finally关闭。保留原回滚、未来版本拒绝、资源释放和全部业务断言；app.ts/server.ts不改。首轮全量1项旧断言失败如实保留，调整后187项通过，不以跳过旧测试验收。

M13最终补强：业务拒绝的幂等键也经SAVEPOINT回滚操作后在同一外层事务记录拒绝响应；同键换请求仍409，数据库故障则整笔回滚。新增重启后失败键重放验证，最终16文件188项通过；M13独立专项30项、真实浏览器4项通过。所有新证据独立存放，正常应用仍待总控挂载。


## M13 审核退回修复（2026-10-19）

审核退回修复沿用已批准 CR-M13-01：追加 v3 admin_review_order，自增持久序号按旧审核 rowid 回填；审核与序号只追加。发布事务读取最新结论并绑定 reviewId/摘要/媒体版本。v1/v2 迁移原文不变。客户端明确新确认使用新幂等键，原确认重试保留原键，服务端幂等事务不变。

## CR-M14-QUERY-01：公开读取快照复用（2026-10-19，总控专项授权）

本轮只修复F-QUERY-PERF。新增内部受控 `ContentDatabase.readPublicSnapshotSince(knownVersion?)`，不暴露连接、SQL或通用事务回调，不改Work/ContentClient/公开DTO、状态码与no-store。无新增迁移，v1/v2/v3原文保持。

每次读取在BEGIN读事务内先通过entities读取钉住WAL快照，再取该连接PRAGMA data_version与total_changes()（转十进制文本），组合本数据库实例随机身份为不透明版本。版本相同才复用；不同时在同一读事务取得原公开原始快照。SQLite在已钉住读事务内保持data_version和行视图，外部提交下一读事务可见；本连接M12/M13写入由total_changes捕获，回滚可多失效但不误公开。版本仅同实例比较，重启重新生成，不是TTL/更新时间事件。

PublicContentService每实例最多保留一份经过原双重白名单投影/严格schema校验及关联过滤的公开快照；≤10000原始公开行且公开JSON UTF-8≤8MiB才保留，超限按原完整流程重建、不截断结果。该上限是缓存保留预算，不是整个V8/进程内存上限。缓存深冻结；列表/首页只复制返回部分，snapshot兼容入口返回完整独立副本；不缓存私有字段或请求ID。具体证据和局限见docs/handoffs/M14-query-performance.md。

## CR-M15-01：专业剪纸编辑器 v2 契约提案（2026-10-23，待总控评审）

提出模块：M15-0。本条只是提案，未批准、未实现，不改变当前 contracts 或任何已保存作品。

原因：现有 `CutOperation` 只能表达 circle/triangle/teardrop，`PapercutCommand` 只有 add-cut/undo/redo/set-palette，无法持久化闭合自由路径，也无法让选择移动、删除和清空通过 core 历史执行。继续复用 v1 字段并原位改变语义会使旧作品被静默改形。

建议新结构：保留现有 `Work`/`CutOperation`/`PapercutCommand` 及所有现有端口继续精确指向 v1；只新增显式 `WorkV1`/`CutOperationV1` 别名、严格 `WorkV2`/`CutOperationV2`/`AnyWork` 和独立命名的 v2 端口。v2 参数切口为 `{kind:'parametric', parameterVersion:2, shape, center, width, height, angleDeg, id, order}`；持久自由切口为 `{kind:'freehand', parameterVersion:2, points, closed:true, id, order}`，points 是六位量化等值的 `[0,1]²` 有限 number、隐式首尾闭合且不重复末点。另新增不持久化的 `FreehandCandidateV2 {id,order,rawPoints}`，rawPoints 按采样顺序保存3～当期 `rawMaxPoints` 个有限坐标；4096只是首轮性能验证候选，不属于持久格式身份。

自由路径责任边界：UI 只做 pointer→纸张坐标映射、按顺序采集和 rAF 绘制，不得去重、RDP、量化、自交或域校验。`add-freehand-cut` 必须接收 `FreehandCandidateV2`，由 core 在同一命令内完成去重后原始路径完整校验、RDP/量化、规范路径再次完整校验及历史提交；可另公开 `prepareFreehandCut`，但它和 dispatch 必须调用同一私有实现，生产写路径不能信任 UI 传入已规范化 operation。浏览器通过 Web Worker 运行同一 core，不产生 UI 算法副本。`update-cut` 第一版只接受平移 delta，由 core 改写并复验，UI 不直接移动保存点。

v2 模板来源选择“v1 来源模板快照 + 独立 editorProfileV2”。`WorkV2.templateSnapshot` 原样保留现有 `TemplateVersionV1`，不改其 id、version、geometryVersion 或 rendererVersion；新增完整 `editorProfileSnapshot`，包含 profileSchemaVersion=2、只追加的正整数 profileVersion、source template id/version/canonical snapshot SHA-256、允许工具/限额及 editor geometryVersion=2/rendererVersion=2。digest 对严格 v1 schema 解析结果的 RFC 8785/JCS UTF-8 字节计算，Node/浏览器用黄金字符串与摘要统一验证。

profile 注册表以 `profileId+profileVersion` 保存不可变 profile，采用追加式版本管理；已用于持久作品的项永久保留兼容读取分支。生命周期元数据 `newWorkEnabled` 只控制新建/另存，停用不得阻止旧作打开/渲染/导出；`historicalMode=editable|read-export-only` 决定旧算法仍可编辑或至少只读导出。恢复必须把 Work 内完整 editorProfileSnapshot 与对应注册项做深值一致性校验，并复核 source digest，不能只比较ID/版本。只有真正未知的 profile/geometry/renderer/parameter 版本或完整快照不一致才失败，不得把当前禁止新建误报为历史损坏。应用以 source id+version+digest 精确匹配现有内容 API 返回的 v1 模板；不得用相同 template id+version 偷加 freehand 规则；本提案不修改内容 API、服务器模板或正式数据库。

建议限额：保存后每条3～512点、每作品自由路径总计最多20000点、全部操作仍最多100；持久坐标只接受有限 number、范围 `[0,1]` 且严格等于六位量化结果。JSON/structured clone 后不能区分 `0.1` 与 `1e-1`，因此不拒绝指数词法，系统只统一规范序列化。去重后的原始闭合路径和 RDP/量化后的规范闭合路径都必须完整执行越界、自交、非相邻接触、面积/周长、基础域/allowedRegion/真实纸边校验，两者任一失败即拒绝。rawMaxPoints=4096 只是 M15-1/2 的暂定非持久候选值；M15-2做算法基准，M15-5做有状态Worker真实浏览器/设备档位验证（候选4096点目标桌面p95≤250ms、移动p95≤1000ms、主线程long task≤50ms），总控在M15-6写入首个正式v2作品前最终批准或调低，不能在缺少Worker证据时冻结。

建议命令：独立 `PapercutCommandV2` 新增 add-parametric-cut、接收 raw candidate 的 add-freehand-cut、只接收 translate delta 的 update-cut、delete-cut、clear-cuts，并保留 undo/redo/set-palette。每个有效命令恰好一个历史步骤；无效命令不改 work/undo/redo；删除后 core 重排 order；update 保持 id/order/kind。旧 v1 命令/端口不切换。

Worker/历史：每个v2编辑会话的专用Worker持有 `PapercutSessionV2`、当前Work和undo/redo；v2历史为最多30个结构共享增量entry（add/update/delete/clear/palette），不是30份完整Work。主线程只发 initialize(work)、dispatch(command)、get-current-work、dispose，并只接收当前确认Work、canUndo/canRedo、sequence、错误及必要摘要；不跨线程发送历史，保存也不持久化历史。initialize完整验证外部Work；后续命令只验证受影响数据和候选新Work，不重复完整校验全部私有历史。sessionId/requestId/sequence防止乱序和旧响应覆盖；切换作品终止旧会话。Worker崩溃以主线程lastConfirmedWork重建、清空历史并明确提示，未确认命令不自动重放或保存。必须测试乱序、重复、旧session、dispose、终止、messageerror和崩溃恢复。

兼容与迁移：v1 始终按 v1 schema/geometry/renderer 只读打开、渲染和导出，不原位升级或重新解释。用户可明确“另存为 v2”：必须先为原 v1 templateSnapshot 找到精确 profile 匹配，再以新 ID/create-only 事务原样保留 v1 templateSnapshot、嵌入 editorProfileSnapshot，并把参数切口转换为 kind=parametric/parameterVersion=2及通过 v1/v2 黄金几何对比；失败、冲突、配额、profile不匹配或未知版本均保留原 v1 记录。v1/v2 可在 IndexedDB 物理 v3 的既有 stores 共存，当前提案不要求物理升版；若 M15-6 发现必须改 store/index，另提 CR。服务器内容数据库和公开内容端口不变。

增量集成：M15-1 只新增类型/schema/独立端口，不改变现有公共别名；M15-2～M15-6 以独立命名的 v2 工厂逐步接入；只有 M15-7 可把 contracts 与所有直接实现方放在同一串行变更中切换通用接口（推荐不切换旧别名，新增代码显式使用 AnyWork）。从 M15-1 起每个模块交付都必须通过根 `pnpm typecheck`，不允许留下等待后续修复的编译断裂。

受影响模块：contracts、papercut-core、artwork-renderer、artwork-exporter、local-repository、web workshop 及各自测试/文档；不影响 API 正式内容数据库。测试至少包括 v1 冻结夹具、profile/source digest、严格联合/未知版本、原始与规范路径双重完整校验、确定性黄金样例、命令历史、SVG union/注入、PNG复用、v1/v2存储共存/冲突/备份和全浏览器验收矩阵。

依赖：推荐零新增生产依赖；本提案不批准安装任何包。总控决定：待评审。批准后也只授权 M15-1 的明确文件范围，不自动授权后续实现、提交、推送或部署。

### 总控准备决定（2026-10-23，Asia/Shanghai）

M15-0 架构审核通过，允许在 M15-1 实施前建立三个追加式 EditorProfileV2 和 v1 兼容夹具的准备基线；这不是 M15-1 contracts 已实现的声明。首批正式来源模板固定为 `template-v1-c01`、`template-v1-c02`、`template-v1-c03`，profile 分别为 `editor-profile-v2-c01`、`editor-profile-v2-c02`、`editor-profile-v2-c03`，均采用 `profileSchemaVersion=2`、`profileVersion=1`、`geometryVersion=2`、`rendererVersion=2`、`newWorkEnabled=true`、`historicalMode=editable`。参数工具严格继承各模板当前 `allowedCuts`：c01 为 circle/teardrop，c02 为 triangle/teardrop，c03 为 circle/triangle/teardrop。自由路径持久规则为 enabled、`minArea=0.00001`、`minPerimeter=0.01`、`maxPoints=512`、`maxTotalFreehandPoints=20000`；已用于持久作品的 `profileId+profileVersion` 只能追加，不能修改或删除。`rawMaxPoints=4096` 仍是后续 Worker 性能测试候选，不进入持久 EditorProfile，也未在本决定中冻结。

本决定只授权 M15-0A 提示词列明的准备文件，不授权实现自由剪刀或 M15-1 公共 contracts，不授权安装依赖、提交、推送、部署或修改服务器、正式数据库及冻结的 `delivery/v1-initial-20261023-final6/`。
