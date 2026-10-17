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

M12 的 `createHttpContentClient(...): ContentClient` 必须实现同一端口，入参/响应均校验，query URL 编码，10秒超时、读取最多重试1次、请求取消/过期响应不覆盖新查询。尚未实现 HTTP 工厂，M01 不发送假业务成功。公开路由对应 PRD `/api/v1/home|crafts|templates|exhibits|stories`，目前后端仅 `/health`。

## 剪纸命令与渲染

`PapercutCore.createState(work)`、`validate(work)`、`dispatch(state,command)` 返回 Result；command 判别 type 为 add-cut(operation) / undo / redo / set-palette(palette)。状态包含只读 work/undo/redo；实现不得原位变更。无效命令状态不变；历史至少30步、最多100个切口；撤销后新操作清空redo；颜色变化不清空切口。core 不分配时间/随机ID、不修改保存 revision；调用方在保存边界处理元数据。

`ArtworkRenderer.render({work,width,height,view:'folded'|'unfolded'})` → `{svg,width,height,rendererVersion:1}`。width/height 为正整数 CSS 逻辑像素，适配保持单位方纸比例并居中；SVG 自包含、无脚本或外链，不改写作品。缺少旧算法版本返回 UNSUPPORTED_VERSION，非法几何返回 GEOMETRY_INVALID。M01 仅接口，没有假渲染。

## 本地仓储

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
