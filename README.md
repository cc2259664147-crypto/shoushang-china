# 手上中国：非遗技艺数字工坊

“手上中国”是一个中国剪纸主题的本地优先网页应用。访客可以浏览展品与人物故事，在数字工坊中选择模板、剪切、折叠预览、保存作品并导出 PNG。访客作品保存在当前浏览器，管理后台默认关闭。

本包是 V1.0 初版候选。版本化内容集 `v1-initial-2026-10-22` 提供 3 套基础模板、12 件独立展品、3 篇故事及 15 项配套媒体，另提供一套自由造型模板。包内文件完整性可用 `DELIVERY-MANIFEST.json` 与 `scripts/delivery/verify-package.mjs` 自行核对；构建、初始化和浏览器流程的实测记录由交付方随批次目录保存，不随本压缩包分发。真人教学、手机真机、队伍资料和官方规则澄清仍须分别完成，不能据此宣称比赛已批准提交。

## 环境与安装

- Node.js `>=24.19.0 <25`
- pnpm `11.25.0`
- Windows、macOS 或 Linux；以下命令使用 PowerShell

在解压后的项目根目录运行。需要网络取得锁文件指定的依赖；不需要全局修改 PATH 或包配置。不要使用 `--prod`，构建、初始化和精简包检查需要包内声明的开发工具。

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check:runtime
pnpm typecheck
pnpm build
pnpm test:delivery
```

`test:delivery` 是包内可运行的真实初始化集成检查，使用独立临时库核对首次初始化、重复执行、已有库保护以及账号/会话清理。它不替代开发仓库的全部单元测试，也不会初始化下文的演示库。首次执行需允许本机回环 HTTP 和子进程。

## 初始化完整内容

数据库、媒体和备份必须位于项目外的私有目录。`.env.example` 仅供参考，不会被命令自动载入。先完成上面的构建，再显式初始化一个新的空目录：

```powershell
$demoRoot = Join-Path $env:LOCALAPPDATA ('shoushang-china/v1-' + [guid]::NewGuid().ToString('N'))
pnpm content:initialize -- --root $demoRoot
```

正式内容输入为 `content/v1-initial-2026-10-22/records.json`，集合说明为同目录 `manifest.json`。初始化工具使用数据库公开封装建立工艺/模板，再通过正常后台受控 HTTP 接口上传媒体、写入来源许可、录入并技术审核内容。内容和媒体使用正常分配的 ID，映射记录在私有根目录的 `v1-initialization.json`。初始化用随机临时账号完成工作后停用这些账号并撤销会话；没有默认管理员或可供登录的默认密码。自动化技术审核和 AI 受托编辑不等于真人审核、法务签字或组委会批准。

成功后得到 `content.sqlite`、`media/`、`backups/` 和完成回执。同版本成功目录再次执行只检查并返回 `unchanged`，不会重复灌入或覆盖修订。已有数据库、非空目录和未完成批次默认拒绝。失败会以非零状态退出；已进入初始化的失败现场保留 `v1-initialization.failed.json`，请保留现场诊断，另选新的空目录重试，不删除原库、不直接修改业务表或复制测试库补齐。

普通 API 启动不会播种、创建账号或重置密码。`apps/api/src/database/development.ts` 仍是开发专用的单模板空内容入口，不适用于本包的完整演示。

## 构建后运行与演示

在终端一继续使用刚才的 `$demoRoot`，或将其设置为已初始化的私有根目录绝对路径：

```powershell
$env:CONTENT_DATABASE_PATH = Join-Path $demoRoot 'content.sqlite'
$env:ADMIN_MEDIA_ROOT = Join-Path $demoRoot 'media'
$env:ADMIN_ENABLED = '0'
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
pnpm --filter @shoushang/api start
```

普通公开模式需要 `ADMIN_MEDIA_ROOT` 读取已获公开引用的图片，即使后台关闭也要设置。此模式不要设置 `ADMIN_ORIGIN`、`ADMIN_SECURITY_MODE` 或 `ADMIN_BACKUP_ROOT`；若当前终端留有旧后台配置，请使用全新的 PowerShell 窗口。目录绝不能由静态服务器公开。

在终端二、同一解压项目根目录运行：

```powershell
$env:API_PROXY_TARGET = 'http://127.0.0.1:3001'
pnpm --filter @shoushang/web preview
```

打开 [本地预览](http://127.0.0.1:4173/)。建议依次演示展馆搜索与详情、来源许可、三篇故事；随后在工坊逐一体验三套模板，剪切、保存、刷新恢复并导出 PNG，再到作品管理查看。模板名称为“方纸镜影：成对留白”“方纸节奏：疏密与方向”“四向回旋：中心与边缘”。访客作品与服务器展馆内容相互独立，不会自动上传。

两个服务分别用各自终端的 `Ctrl+C` 停止。`/health` 仅表示服务存活，`/ready` 还会实际检查数据库。本包是需要 Node 依赖和本地服务的应用，不能直接双击 `index.html` 运行。公网 HTTPS、同源反向代理、操作系统权限、监控和持久卷需要目标环境另行配置。

## 可选后台维护与备份

后台默认关闭。确需维护时先停止 API，设置完整配置；以下沿用同一私有根目录：

```powershell
$env:ADMIN_ENABLED = '1'
$env:ADMIN_SECURITY_MODE = 'loopback-http'
$env:ADMIN_ORIGIN = 'http://127.0.0.1:4173'
$env:ADMIN_MEDIA_ROOT = Join-Path $demoRoot 'media'
$env:ADMIN_BACKUP_ROOT = Join-Path $demoRoot 'backups'
node apps/api/dist/admin/maintenance.js create-account $env:CONTENT_DATABASE_PATH local-admin admin
pnpm --filter @shoushang/api start
```

维护命令在隐藏终端输入密码两次；不把密码写进参数、环境变量、日志或文件。打开 [后台](http://127.0.0.1:4173/admin) 使用自行创建的账号。后台操作有角色、CSRF、修订冲突和媒体许可检查，不能绕过这些入口直接修改数据库。

完整鉴权、维护、联合备份和离线恢复步骤见 [API 运行说明](docs/api/integration.md)。数据库备份不包含媒体；后台联合备份同时保留数据库、媒体和私有凭证。恢复必须停服务并进入全新的不存在目录。恢复副本停用账号并撤销会话，安全及许可台账复核后才可逐一启用。

## 内容、AI 与许可

三套模板是项目生成的数字练习，AI 参与了设计与整理；它们不构成地方传统工序、实体可剪性或真人教学验收。故事页面现展示周淑英照片、张秀芳《桃花柳燕》和陈秋日《秋实》图片，图片来源与署名见第三方署名清单。数据库仍保留项目生成的备用示意封面。没有虚构真人作者、采访、合同或独占著作权。来源、署名和修改说明见：

- [内容定版状态](docs/content/content-finalization.md)
- [第三方署名](docs/content/ATTRIBUTION.md)
- [媒体权利台账](docs/content/media-rights.md)
- [第三方依赖与字体许可](docs/third-party-dependencies.md)

历史 E-R06、E-R15、E-R16因比赛复制与再分发依据不足退出当前内容集，其原图及旧记录保留在原仓库历史资料中，不放入本次参赛候选包。现用新记录 E-R17“百福”（CC BY-SA 3.0）、E-R18“金鱼”和 E-R19“花边”（台湾文化记忆库，CC BY 3.0 TW）按各自来源保留作者、许可链接和处理说明。第三方署名在匿名版中同样保留；“匿名”不免除署名或相同方式共享义务。

## 检查命令与故障排查

精简交付包随附 `test:delivery` 检查，不附开发仓库全部 `*.test.*` / `*.spec.*`。包内必需命令是本页的 `pnpm typecheck`、`pnpm build`、`pnpm test:delivery` 和显式内容初始化。不要在精简包执行 `pnpm test`，该命令仅适用于保留完整测试文件的开发仓库：

```powershell
# 仅在完整开发仓库执行
pnpm test -- --maxWorkers=1 --no-file-parallelism
```

- 页面为空：确认使用正式内容初始化且 API 指向对应 `content.sqlite`；单模板开发初始化不带展品和故事。
- 图片不可读：检查 API 的 `ADMIN_MEDIA_ROOT` 与初始化回执一致，且媒体未被下架或撤权；不要将私有目录改成静态目录。
- `/health` 成功而 `/ready` 失败：检查数据库路径、初始化结果和文件权限。
- 后台路由不存在：默认关闭时属预期行为；启用时检查全部配置及精确网页 Origin。
- 端口占用：只停止自己启动的旧服务，或同步修改 API 端口、代理地址及后台 Origin。
- 初始化失败或拒绝：保留错误现场并选择新的包外空目录，不覆盖已有维护内容。

真人教学、五名独立用户、iOS/Android 真机、真实队伍资料、冲突赛事要求与目标生产部署均有各自验收边界。候选包范围与核验方法见 [交付说明](docs/delivery/README.md)。
