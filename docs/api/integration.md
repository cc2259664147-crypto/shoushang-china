# API 运行、内容初始化与后台维护

当前操作基线：V1.0 初版候选，2026-10-23。此页面向解压交付包后的维护者；M12/M13历史验证结果和当时未实现项保留在原交接中，不能作为本轮执行记录。实际新解压验证以本批次最终交接为准。

## 全新内容初始化

要求 Node `>=24.19.0 <25`、pnpm `11.25.0`。从项目根目录安装完整工具依赖并构建，数据库、媒体和备份置于项目外的私有绝对目录：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test:delivery
$demoRoot = Join-Path $env:LOCALAPPDATA ('shoushang-china/v1-' + [guid]::NewGuid().ToString('N'))
pnpm content:initialize -- --root $demoRoot
```

版本化内容集 `v1-initial-2026-10-22` 的预期数量为 1 个工艺、3 套模板、12 件独立展品、3 篇完整故事和 15 项媒体。正式内容输入为 `content/v1-initial-2026-10-22/records.json`；同目录 `manifest.json` 记录集合、媒体 manifest 和显式初始化入口。包内初始化不依赖 `tests/m14`、旧临时库或测试账号。

工艺和模板通过 `ContentDatabase.initializeBaseContent` 公开封装建立；媒体上传、许可记录、草稿、提交、审核和发布经过正常受控后台 HTTP。服务端分配媒体与内容 ID，完成回执记录候选编号映射。初始化账号和密码随机生成，只用于该次受控流程；结束时注销会话、停用账号并撤销会话，不留下默认管理员或可用默认密码。审核文字明确标为自动化技术核对，不代替真人编辑、法务批准或比赛授权。

成功生成 `content.sqlite`、`media/`、`backups/` 和 `v1-initialization.json`。完成批次重复执行返回 `unchanged`，不覆盖修订或重复灌入。已有库、非空目录或未完成批次默认拒绝；失败非零退出，已进入初始化的失败保留 `v1-initialization.failed.json`。保留失败现场，用新的包外空目录重试，不直接 SQL 修业务表或复制测试库。

单模板入口 `apps/api/src/database/development.ts --initialize-development` 仅供完整开发仓库研究空态，不能用于完整演示。正常启动不调用任一内容初始化工具，也不静默创建账号、播种或重置密码。

## 正常公开模式

`.env.example` 不会自动载入。终端一使用已初始化的私有根目录：

```powershell
$env:CONTENT_DATABASE_PATH = Join-Path $demoRoot 'content.sqlite'
$env:ADMIN_MEDIA_ROOT = Join-Path $demoRoot 'media'
$env:ADMIN_ENABLED = '0'
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
pnpm --filter @shoushang/api start
```

终端二位于同一项目根目录：

```powershell
$env:API_PROXY_TARGET = 'http://127.0.0.1:3001'
pnpm --filter @shoushang/web preview
```

网页默认 [4173](http://127.0.0.1:4173/)。普通模式仍须设置 `ADMIN_MEDIA_ROOT`，公开图片只经 `/api/v1/media/:id/:variant` 的公开引用/撤权检查读取；此变量名称不表示后台必须开启。不要设置普通模式不需要的 `ADMIN_ORIGIN`、`ADMIN_SECURITY_MODE` 或 `ADMIN_BACKUP_ROOT`。如终端存在旧后台变量，使用新窗口并重新设置本节变量。数据库、媒体与备份绝不能由 Vite 或其他静态服务器直接公开。

API 构建产物使用普通 Node，Fastify 和 sharp 从冻结依赖加载；不是单文件无依赖部署。`pnpm dev` 可在开发仓库使用正常 HTTP 配置启动 5173，但后台 Origin 也必须相应改为精确的 5173 Origin。Vite dev/preview 代理 `/api`、`/health` 和 `/ready`，正式部署需要独立的同源 HTTPS 反向代理。当前没有跨源 CORS 或公网部署承诺。

## 存活、就绪、查询与媒体

```powershell
Invoke-RestMethod 'http://127.0.0.1:3001/health'
Invoke-RestMethod 'http://127.0.0.1:3001/ready'
Invoke-RestMethod 'http://127.0.0.1:3001/api/v1/templates?craftId=craft-papercut&pageSize=50'
Invoke-RestMethod 'http://127.0.0.1:3001/api/v1/exhibits?pageSize=50'
Invoke-RestMethod 'http://127.0.0.1:3001/api/v1/stories?pageSize=50'
```

`/health` 只表示进程存活；`/ready` 实际读取数据库，正常为 HTTP200/ready，依赖不可读为 HTTP503/not-ready。打开或迁移失败则启动退出，不监听端口。诊断不输出数据库绝对路径、SQL、凭据或堆栈。

内容响应保持 `{ok:true,value}` / `{ok:false,error}`，失败不回退 mock。列表、搜索、详情、首页与关联只读取当前公开投影，下架和媒体撤权会影响新响应。公开 DTO 不输出 proofRef、内部证据路径、账号或密码哈希。私有许可依据无公开 URL；撤权不能追回已经下载的文件，部署缓存策略仍须另行控制。

## 可选后台与账号维护

后台页面位于 `/admin`，管理 API 位于 `/api/v1/admin/*`。默认关闭且不挂载管理路由。启用时设置完整配置：

| 变量 | 用途 |
| --- | --- |
| `ADMIN_ENABLED=1` | 显式启用后台 |
| `ADMIN_SECURITY_MODE=loopback-http` 或 `https` | 本地回环 HTTP 或正式 HTTPS Cookie 策略 |
| `ADMIN_ORIGIN` | 精确信任的网页 Origin，preview 为 `http://127.0.0.1:4173` |
| `ADMIN_MEDIA_ROOT` | 项目外私有媒体及许可依据目录，公开模式也需要它读取图片 |
| `ADMIN_BACKUP_ROOT` | 项目外独立联合备份目录，只在启用后台时设置 |

`CONTENT_DATABASE_PATH` 也须为项目外绝对私有路径。媒体、备份不得在项目树或符号链接目标内，不得相互包含或包含数据库。部署者需设置 OS 文件权限；本地回环模式的 HOST、Origin 和实际监听地址必须均为回环。HTTPS 使用精确 HTTPS Origin 及 HttpOnly/Secure/SameSite=Strict Cookie，服务不信任任意 `X-Forwarded-*`。角色、CSRF 和修订预期逐请求检查。

先停止本服务，保留数据库与媒体；若是旧版本库，先让关闭后台的正常 API 完成迁移前备份及迁移，再停止服务运行维护命令。以下命令使用构建产物：

```powershell
$env:ADMIN_ENABLED = '1'
$env:ADMIN_SECURITY_MODE = 'loopback-http'
$env:ADMIN_ORIGIN = 'http://127.0.0.1:4173'
$env:ADMIN_MEDIA_ROOT = Join-Path $demoRoot 'media'
$env:ADMIN_BACKUP_ROOT = Join-Path $demoRoot 'backups'
node apps/api/dist/admin/maintenance.js create-account $env:CONTENT_DATABASE_PATH local-admin admin
pnpm --filter @shoushang/api start
```

密码在隐藏 TTY 中输入两次，不存于参数、环境变量或日志。无公开注册或默认账号。编辑账号将末尾角色改为 `editor`。账号停用/启用也必须停服务，并通过维护入口显式执行：

```powershell
node apps/api/dist/admin/maintenance.js disable-account $env:CONTENT_DATABASE_PATH local-admin
node apps/api/dist/admin/maintenance.js enable-account $env:CONTENT_DATABASE_PATH local-admin
```

以上为两种相反操作的语法示例，不应无目的连续执行；启用前需核对安全台账，状态更改会撤销会话。网页直接访问或刷新 `/admin/*` 时，正式静态服务器需回退到 `index.html` 并继续代理 API，不能把私有目录公开。

## 备份、离线恢复与失败处理

每次正常打开已有数据库前，应用先生成 `<数据库路径>.backups/startup-<时间>-<UUID>.sqlite` 一致性快照，成功后才迁移。该快照不覆盖旧文件，失败则停止启动；它只保护数据库，不是整站联合备份、定时备份或七天轮换。WAL 运行期间禁止只复制主 `.sqlite` 文件。

后台管理员可创建联合备份任务，须查询任务状态确认成功，不能把已排队当完成。成功目录包含 `manifest.json`、`content.sqlite` 及媒体/私有依据文件；维护者保留其校验和、版本与后续停用/撤权台账，且不要将备份映射为静态路径。浏览器 IndexedDB 中的访客作品不在服务端备份中。

恢复前停止所有使用该库/媒体的宿主和复制进程，保留原目录。恢复目标必须是项目外全新、尚不存在的绝对目录，不预先创建它：

```powershell
# 将这两个路径替换为实际成功备份与全新恢复目标
$backupDirectory = '<项目外成功联合备份目录绝对路径>'
$newRestoreDirectory = '<项目外尚不存在的恢复目录绝对路径>'
node apps/api/dist/admin/maintenance.js restore $backupDirectory $newRestoreDirectory --all-hosts-stopped
```

恢复器验证 manifest、数据库及每个媒体哈希、路径、完整性与外键；恢复到新目录后停用所有账号并撤销所有会话。失败保留私有新目录，绝不自动切换宿主。成功也须核对快照之后的账号停用、下架和媒体撤权记录，复核来源许可，检查首页/列表/详情/关联及媒体，再决定是否逐个启用账号和切换配置。只修改 `CONTENT_DATABASE_PATH` 和 `ADMIN_MEDIA_ROOT` 指向新副本；不要重新播种或自动降级数据库回退。为新副本选择独立备份根。

正式生产 ACL、TLS 代理、sharp/libvips 的内存与 CPU 限制、监控、保留周期及 RPO/RTO 仍需目标环境验收。用各自终端 `Ctrl+C` 停止自己启动的 API 和 preview；不要按端口或进程名批量终止其他会话。

## 开发仓库检查与历史边界

精简包必需检查为 `pnpm typecheck`、`pnpm build` 和 `pnpm test:delivery`。完整开发仓库另可运行：

```powershell
pnpm test -- --maxWorkers=1 --no-file-parallelism
pnpm exec tsc --noEmit -p tests/m14/tsconfig.json
```

精简包不附全部测试文件及 M14 浏览器 runner，上述两条只适用于完整开发仓库；不能在精简包要求它们成功，也不允许用空测试掩盖缺失。隔离测试不得读取真实用户库或日常浏览器 profile，正常启动链路不导入 fixtures 或测试 runner。

M12曾只有单模板开发初始化、纯数据库备份和未受控媒体 URL；M13增加鉴权后台、媒体受控入口和联合备份。旧 M12/M13交接中的“尚未实现”与旧审计数量只代表当时状态。V1增加显式完整内容初始化和后台关闭时的公开媒体读取，实际回归、安全审计及新解压结果由本批次交接记录，不把历史测试冒充本轮执行。
