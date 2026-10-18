# 手上中国：非遗技艺数字工坊 · M01–M03

## M05 本地存储验证

`pnpm m05:dev` 启动独立工具 http://127.0.0.1:5176/ （strictPort）。`pnpm m05:typecheck`、`pnpm m05:test`、`pnpm m05:build` 分别执行严格检查、自动启动验证服务的真实 Edge/IndexedDB 测试、独立构建。测试使用专属数据库名和临时持久浏览器目录，不清理真实应用数据。工具会显示作品修订、时间、草稿、测试缩略图、收藏和损坏记录；它没有接入正式网页。存储设计见 [IndexedDB v1](docs/storage/indexeddb-v1.md)。

这是工程检查入口，尚非正式产品。代码根目录为 `C:\Users\mmcn\Desktop\shoushang-china\shoushang-china`。上级 Markdown PRD 保持原样，sources/ 未修改。

## 环境与安装

锁定 Node.js 24.19.0（24 LTS）、pnpm 11.25.0。使用当前受管理运行时，不全局安装、不修改系统设置。PowerShell 当前窗口可运行：

```powershell
$env:PATH = 'C:\Users\mmcn\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
Set-Location 'C:\Users\mmcn\Desktop\shoushang-china\shoushang-china'
pnpm install --frozen-lockfile
pnpm dev
```

包管理器已在本机受管理路径可用。所有版本精确声明，锁文件锁定传递依赖。pnpm 缓存/存储路径通过工作区配置限定在代码目录内。不需要全局工具；工作区仅放行 esbuild 的必要安装校验脚本。端口被占用时明确报错，不静默换端口。

打开 http://127.0.0.1:5173 ，看到“项目已启动”、`mock` 模式、通过内容访问层取得的“开发占位：几何纸样”及自制示意。后端 http://127.0.0.1:3001/health 返回 `status: ok`、`contentMode: mock`、`database: not-initialized`。Ctrl+C 停止两个开发服务。健康检查不代表数据库已就绪。

## 命令

```powershell
pnpm dev           # 同时启动 Vite 5173 / Fastify 3001
pnpm typecheck     # 全项目 strict + contracts 无 DOM 检查
pnpm test          # 契约、mock、内存仓储、健康接口
pnpm build         # 类型检查、web 静态构建、API 构建
pnpm check:runtime # :memory: SQLite 引擎能力检查，不初始化数据库业务
pnpm --filter @shoushang/api start # 构建后的 API
pnpm --filter @shoushang/web preview # 构建后的前端 4173
```

`apps/web/dist` 是前端静态产物；API 入口是 `apps/api/dist/server.js`（保留 node_modules 中 Fastify）。开发页通过 Vite 代理 `/health`，生产反向代理配置留待部署。Playwright 已锁定依赖及配置，M01–M03复用本机Edge检查，正式核心流程E2E留给M14；现有检查不代表正式产品验收完成。

## 结构与职责

| 目录 | 用途 |
| --- | --- |
| apps/web/src/app | 总控组合根和检查页，后续负责路由 |
| apps/web/src/features | home / workshop / gallery / stories / my-works / admin 隔离目录 |
| apps/web/src/styles | 总控维护的自编全局 CSS |
| apps/api/src | Fastify 健康检查；M12/M13 以后加入真实内容和管理服务 |
| packages/contracts | Zod 公共模型、类型和模块端口 |
| packages/ui | M03 自编 CSS 基础组件与公开样式入口 |
| packages/papercut-core | M04 纯逻辑接口 |
| packages/artwork-renderer | M06 SVG 渲染接口 |
| packages/local-repository | M05 接口和 M01 测试用内存实现 |
| packages/artwork-exporter | M08 PNG 导出接口 |
| packages/content-client | ContentClient 模拟适配器，后续 HTTP 保持同接口 |
| fixtures | 确定性开发占位数据，与公开 DTO 同 schema |
| docs | 架构、数据契约、模块任务、交接与依赖清单 |

模块协作先读 AGENTS.md、docs/tasks/Mxx.md。详见 [模块边界](docs/architecture/module-boundaries.md)、[数据模型](docs/contracts/data-model.md)、[模块 API](docs/contracts/module-api.md)、[第三方依赖及许可](docs/third-party-dependencies.md)、[M01 交接](docs/handoffs/M01.md)。

## 能力边界

M01 仅 mock 内容，不访问真实内容服务。内存仓储未连接页面，刷新后数据丢失；IndexedDB 留给 M05。SVG 示意是项目自制 CC0 几何图，不是文化展品。无真实人物、采访和荣誉；故事明确开发占位，不可直接发布。SQLite 采用 Node 24 内置 node:sqlite（SQLite 公有领域）；业务表、迁移、鉴权、备份和真实内容 API 留给 M12/M13。

正式首页、工坊、展馆搜索收藏、故事页、我的作品、PNG、后台和持久化均未开发。首发个人作品只保存在当前浏览器，不含注册、云同步、评论、支付、多技艺编辑器。正式公开展馆与个人作品隔离。

自编 CSS，禁止预设样式组件库与现成网站模板。依赖只用于框架、服务、校验、开发和测试，不能替代原创页面设计。必要依赖变更由总控批准并锁定。

可选检查页浏览器验证（保持 pnpm dev 运行，需本机已有 Edge，不下载浏览器）：`pnpm exec node scripts/smoke-m01.mjs`。它只验证 M01 检查页，不代表正式核心流程 E2E 通过。

## GitHub 版本管理

私有仓库：https://github.com/cc2259664147-crypto/shoushang-china 。当前目录是 Git 根目录，默认分支为 main，远端名为 origin。原始 PRD 在上一级目录，保留在本地资料目录；本仓库记录代码及工程文档。

后续阶段沿用本仓库，先检查 `git status`，按任务范围提交，由总控整合后 `git push origin main`。禁止强制推送和提交凭据。依赖、包缓存、dist 和 `.env` 已排除；`.gitattributes` 统一文本为 LF。Git 身份仅配置在当前仓库，未改变全局设置。

## M02 隔离剪纸技术原型

原型位于 `prototypes/papercut-verification`，与 M01 页面/服务分开。使用上述受管理 Node 环境。

```powershell
pnpm m02:dev       # http://127.0.0.1:5174 ，占用即报错
pnpm m02:typecheck # 原型完整 strict 检查 + 纯核心无 DOM 检查
pnpm m02:test      # 原型算法测试
pnpm m02:build     # 原型类型检查与 Vite 构建
pnpm --filter @shoushang/papercut-verification verify:browser # 保持5174运行；本机Edge/Playwright，无下载浏览器
```

也可 `cd prototypes/papercut-verification` 后分别运行 `pnpm dev`、`pnpm typecheck`、`pnpm test`、`pnpm build`。根目录原有四个同名命令仍服务 M01，不包含原型；两套检查需要分别运行。

仅支持方纸、竖轴镜像、四扇区无镜像，提供三角/椭圆/水滴、数值参数、30步历史、SVG与1600×2000不透明PNG。JSON重建只作技术测试，无IndexedDB、自动草稿、作品列表和同步。刷新会失去内存状态。参数与按钮可独立操作；本原型未实现拖动。

详见 [算法约定](prototypes/papercut-verification/ALGORITHM.md)、[M02交接](docs/handoffs/M02.md)。证据位于原型 `evidence/`；构建与依赖目录不提交。

## M03 基础 UI 组件预览

使用上述Node24.19.0/pnpm11.25.0环境，离线缓存已具备时可`pnpm install --frozen-lockfile --offline`。独立页面通过`@shoushang/ui`与`@shoushang/ui/styles.css`公开入口复用，无正式业务页面或持久化。所有演示均明确标识。

```powershell
pnpm m03           # 等同m03:dev
pnpm m03:dev       # http://127.0.0.1:5175/，strictPort，占用即失败
pnpm m03:typecheck # UI包、预览源码与Vite配置的完整strict检查
pnpm m03:test      # 上述类型检查 + 真实Edge交互验证与截图
pnpm m03:build     # 上述类型检查 + 独立预览构建
```

运行`m03:test`前需保持5175预览服务运行，并已安装本机Microsoft Edge。脚本使用已有Playwright1.56.1的`channel:msedge`，不会下载浏览器、安装工具或退出现有服务；无Edge或未启动服务会明确失败。M01的5173与M02的5174保持独立。构建结果在`prototypes/ui-preview/dist`；测试证据在其`evidence`目录。根typecheck/test/build不替代M03专项检查。

消费方式：组合根加载一次`import '@shoushang/ui/styles.css'`，外层容器添加`className="ss-theme"`，只从`@shoushang/ui`导入组件。详见[视觉基线](docs/design/ui-foundation.md)、[组件API](docs/design/ui-components.md)、[M03交接](docs/handoffs/M03.md)。本机沙箱若阻止esbuild读取祖先目录，需要受审查的本机执行权限；不通过修改编译严格选项绕过。
