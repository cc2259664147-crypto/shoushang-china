# 数据模型 v1

权威定义：packages/contracts/src/model.ts（Zod schema + z.infer 类型），ports.ts 定义跨模块调用。所有对象 strict，未知字段拒绝；不是简单删除私密字段后直传数据库记录。源代码注释与本文共同约束，改动由总控处理。

## 单位、版本和共同约束

时间为带时区的 ISO 8601 字符串，接受 UTC Z 或显式 offset，服务端持久化规范为 UTC Z。界面 Asia/Shanghai；本地设备时间不用于后台安全判定。ID 为 1–128 字符 `[a-zA-Z0-9_-]`，生产生成不可猜测 UUID；确定性开发 ID 不作生产生成方案。文本 trim 后非空，不允许正文 HTML。

作品局部纸张坐标：原点左上、x 向右、y 向下，纸张包围框为 `[0,1]×[0,1]`。基础方纸铺满单位框；圆纸圆心 `(0.5,0.5)`、半径 `0.5`。屏幕缩放保持比例，不改变保存数据。

center 是剪切形状中心（circle 为椭圆中心、triangle/waterdrop 为参数包围框中心）；width/height 是旋转前包围框相对纸张边长的比例，范围 `(0,1]`。angleDeg 为绕 center 顺时针旋转，范围 `[0,360)`，0 表示未旋转。三角形未旋转时顶点 `(0,-h/2),(-w/2,h/2),(w/2,h/2)`；水滴未旋转时尖端朝上，具体贝塞尔公式由 M02 验证后固化在 geometryVersion=1 的算法规范中，正式算法未冻结前不得发布持久作品。圆形使用 width/height 椭圆定义，不隐式强制等宽。

reflection 的 vertical/horizontal 轴分别 x=0.5 / y=0.5，both 为两轴；radial 以 `(0.5,0.5)` 为中心，sectors 为 4/6/8 等分，0 方向向右；mirror 表示每扇区镜像。allowedRegion 顶点按路径顺序闭合，以未复制剪切中心所在原始折叠区域表达。minEdgeGap 是纸边单位的最小间距。对称基础域、镂空边界距离、相交/连通性、模板规则限制、切口是否完整在允许区域，由 papercut-core 做业务校验；Zod 只负责结构、数值范围及结构一致性，不能把合法 schema 当作可剪。

模板版本一经用于作品不可原位改写。Work 固化完整 TemplateVersion（geometry、allowedCuts、rules、颜色、license、geometryVersion、rendererVersion），不依赖远端模板仍然在线。新增支持必须保留旧版本算法或提供经验证迁移；未知版本明确失败，不悄悄按新算法重画。

## 字段字典

| 对象 | 字段与约束 |
| --- | --- |
| Craft | id/name/slug/description；slug 小写字母数字短横线；status active/archived；supportsExperience 是否有体验能力（不等于 M01 已有可用 UI） |
| TemplateVersion | id 为逻辑模板 ID、version 正整数共同定位不可变版本；craftId/name/difficulty(beginner/advanced)/steps/enabled；geometry 含 basePaper、symmetry、allowedRegion；allowedCuts 非空且形状唯一，每种 shape 有 min/maxWidth、min/maxHeight；rules.minEdgeGap 0–1、maxOperations 1–100；recommendedColors HEX6；license/digitalNotice；geometryVersion=1、rendererVersion=1 |
| CutOperation | id 唯一；shape circle/triangle/teardrop；center{x,y}、width/height/angleDeg 见单位；order 从0连续递增；parameterVersion=1；最多100条，模板可收紧 |
| Work | id/name(1–30字符，允许重名)/craftId；templateSnapshot；palette.paper/background HEX6；operations；status draft/completed；schemaVersion=1；revision 非负，未保存0、保存成功从1递增；createdAt/updatedAt 且后者不早于前者。工艺与快照一致、操作ID唯一且顺序连续 |
| Exhibit | id/title/craftId/category/tags/summary/description；media 至少1；sources 至少1；storyIds/templateIds；dateLabel(未知写未注明)/region/creator/meaning/sortOrder；revision 正整数、updatedAt、developmentOnly。公开对象只代表已发布内容，mock 例外仅供开发 |
| Story | id/title/personName/personBio/craftIds(非空)/region/summary/cover；body 为 paragraph/text 数组非空；timeline 含 dateLabel/text/sources；sources 非空；exhibitIds/templateId(可选)；sortOrder/revision/updatedAt/developmentOnly。时间线少于3节点用普通排版，不编造节点 |
| Media | id/url(HTTP(S)或同源根路径)/alt/author/license{name,attribution,url?}；可选source和modification用于公开来源及编辑改动披露；width/height(1–6000整数)/kind(illustration或photograph)；禁止 proofRef、凭证地址和后台字段；占位 SVG 为代码内置自制资源，后台上传仍仅 JPEG/PNG/WebP |
| Source | title/author/url?(HTTP(S))/accessedAt/citation/note；事实来源与图片许可分离；开发来源明确不是文化证据 |
| Favorite | exhibitId/createdAt，同浏览器 exhibitId 唯一；下架后只显示不可用引用并可移除 |
| Page<T> | items/total(非负整数)/page(从1)/pageSize(1–50默认12)；空结果成功返回 items=[]，不是404 |
| ContentQuery | q trim、小写、≤100字符；craftId/category/tag 可选；page/pageSize；条件取交集；排序 sortOrder 后 id 稳定排序；模板按 craftId/q，故事按 craftId/q，展品支持全部筛选，其他筛选字段不影响对应列表 |
| ApiError | code/message/requestId/fieldErrors[{path,message}]；外部错误不含 SQL、堆栈或凭据 |
| Health | status=ok/service=@shoushang/api/version=0.1.0/contentMode=http；仅存活性，不含数据库状态 |
| Readiness | status=ready/database=ready 时 HTTP200；status=not-ready/database=unavailable 时 HTTP503；service/version/contentMode 同 Health；不含路径、SQL或凭据 |

用户作品与公开展馆是不同数据空间。访客本地保存不触发发布、不上传服务端。发布数量、真实传承人信息、媒体授权属于后续正式内容验收；M01 样例不足以满足 PRD 的3模板/12展品/3故事目标。

Work 名称长度按 JS UTF-16 code units 校验，所有模块须同口径（常见汉字1单位、部分表情2单位）；后续如需字素簇计数，先走公共契约变更。schemaVersion 的兼容与迁移由 M05 实现，M01 拒绝非1版本。

## M04算法与历史补充

geometryVersion=1的正式实现基线见[算法v1](../algorithms/papercut-v1.md)，状态为实现基线已确定、待阶段审核；未批准正式发布。支持方纸vertical或radial4无镜像、三种形状、凸allowedRegion。schema中其余组合可表达但未实现，core明确失败。容差、保守曲线限制和镂空并集语义均按该规范。

Work与PapercutState结构不变。历史虽然保存完整Work，但undo/redo只应用operations和palette；名称、模板、身份、revision、createdAt/updatedAt和status保持当前值。核心不更新时间/修订、不保存。完整模板快照须与历史深值相同，外部模板改动不影响已复制的作品；模板切换重新createState。M05恢复失败保留原记录并解释版本/参数错误；不借此自动清空或迁移。旧版本迁移及持久化事务不属于M04。

## M13 服务端管理扩展 v2（2026-10-19，已批准并实施）

同一 ContentDatabase 在 v1 后追加迁移 v2，保留 v1 SQL 和所有既有历史。新增 admin_accounts/sessions/challenges/limits/reviews/idempotency/media/audit/vocabulary/backup_jobs/maintenance；管理能力从 database.admin 的专用方法调用，不公开原始连接、SQL 或通用事务回调。管理 HTTP/页面在独立模块中，尚未挂入正常应用。

revisions 仍是唯一内容修订体系：exhibit/story 草稿允许字段缺省及部分来源；服务端写入 ID/revision/UTC updatedAt 和台账白名单媒体。提交、审核及发布需通过完整公开 DTO schema、许可/使用范围/凭证、事实与人物引用核验记录、关联和固定模板有效性检查。编辑创建新不可变修订，公开指针不变；不修改 Work、ContentClient 或公共业务 DTO。

账号保存每用户随机盐 scrypt 参数化摘要；会话仅保存 token SHA-256 摘要、authVersion、CSRF 摘要和绝对有效期。角色和停用状态在每个管理写事务内重验。幂等唯一键为 actor+operation+key，与双头 CAS、公开指针和成功审计同事务；审核绑定修订 payload 摘要与媒体台账版本。proof_key/proof_hashes、密码摘要、令牌和操作内部字段不进入公开 DTO；公开 Media 只包含受控原图路由与审核台账白名单中的公开来源、许可URL和修改说明。

图片为 sharp@0.35.5（总控后续定向批准由0.34.5调整），解码/重编码后存不可变 PNG 原图与真实缩略图；数据库存其哈希、尺寸、原输入格式、作者、来源、许可、使用范围、所有者、版本和 staged/approved/revoked 状态。许可凭证始终私有。撤权同步写 M12 revoked_media，当前公开内容和图片后续读取均拒绝。

备份锁持久化且过期不自动解除，覆盖旧写入与新管理写入；快照、媒体/凭证文件和 manifest 为可验证协调流程，不宣称跨文件系统/SQLite 原子性。离线恢复只写新目录，校验哈希/完整性/外键，默认停用全部恢复账号并撤销会话；核对安全账本后维护者逐个启用。具体字段、维护命令与边界见 apps/api/src/admin/README.md 及 docs/handoffs/M13.md。

失败审计防洪泛：公开媒体404不写管理审计，后台失败每身份/匿名桶每分钟最多60条详细事件，超出保留持久聚合计数；成功敏感操作审计不采样。聚合计数同样遵守备份维护锁，存储不可用时不声称日志已落库。


## M13 审核退回修复（2026-10-19）

v3 新增 admin_review_order(sequence INTEGER PRIMARY KEY AUTOINCREMENT, review_id UNIQUE REFERENCES admin_reviews)。v2 升级按历史 rowid 回填，以后由审核 INSERT 触发器同事务分配；排序不依赖 created_at。审核和序号禁止 UPDATE/DELETE，当前修订最新序号的结论是唯一有效审核。

## M14-2A 公开快照缓存边界

无数据库表、字段或迁移变化，v1/v2/v3保持。实例私有版本由随机实例身份、同一已钉住读事务中的SQLite data_version和total_changes十进制文本组成；只在本实例内比较，不写数据库、不投影HTTP。只保存原公开白名单与schema校验/关系过滤后的DTO，深冻结并独立复制输出；每服务最多一份≤10000公开行/8MiB公开UTF-8 JSON的保留预算，超限仍完整读取。账号/会话/审核/发布/撤权/备份/维护锁及旧写入口不变；外部连接或进程提交在下一读事务失效，本连接回滚允许保守重建。重启无缓存。
