# 第三方依赖、用途与许可

本表按 2026-10-23 当前依赖清单及 `pnpm-lock.yaml` 编写；直接依赖采用精确版本，传递版本由冻结锁文件确定。`pnpm install --frozen-lockfile` 保持该组合，不能用批量升级或 `audit fix` 代替逐项安全判断。安装、构建及内容初始化需要开发工具，精简交付包不能使用仅生产依赖安装。

## 当前直接依赖与运行时

| 依赖 | 当前版本 | 用途与可达范围 | 许可 |
| --- | --- | --- | --- |
| Node.js | 要求 `>=24.19.0 <25`；本批最终验证环境 24.22.1（历史基线 24.19.0） | API、内置 SQLite、构建与维护命令运行时 | MIT，并附 Node 上游第三方通知 |
| node:sqlite / SQLite | 3.53.4（随 Node 24.22.1）；历史基线 3.53.3（随 Node 24.19.0） | 正式磁盘内容库、事务、一致性备份与恢复检查；不是内存占位库 | Node MIT / SQLite Public Domain |
| pnpm | 11.25.0 | workspace、冻结锁文件安装和脚本调度 | MIT |
| React / react-dom | 19.2.0 | 浏览器界面与 DOM 挂载 | MIT |
| Fastify | 5.12.6 | 生产 API、公开媒体、后台受控 HTTP、健康与就绪检查 | MIT |
| sharp | 0.35.5 | 服务端媒体完整解码、格式处理、缩略图及初始化技术记录图 | Apache-2.0；平台二进制另有下述许可 |
| Zod | 4.1.12 | 公共 DTO 和输入运行时校验 | MIT |
| TypeScript | 5.9.3 | strict 类型检查；开发/构建工具 | Apache-2.0 |
| Vite | 7.3.7 | 前端开发、构建及本地 preview；不是公网生产服务承诺 | MIT |
| esbuild | 0.25.11（直接声明） | API 打包及底层转换；开发/构建工具 | MIT |
| tsx | 4.20.6 | TypeScript 开发、显式内容初始化与 `test:delivery`；正常构建后 API 用 Node | MIT |
| concurrently | 9.2.5 | 本地 `pnpm dev` 同时启动前后端；精确更新其 shell-quote 依赖 | MIT |
| Vitest | 4.1.12 | 完整开发仓库单元/集成测试；根与原型两处声明一致；精简包不附全部测试文件 | MIT |
| @playwright/test | 1.56.1 | 完整开发仓库独立浏览器流程回归；精简包启动不依赖浏览器测试 runner | Apache-2.0 |
| @types/node | 24.10.0 | Node 类型；仅类型/开发 | MIT |
| @types/react / @types/react-dom | 19.2.2 | React 类型；仅类型/开发 | MIT |

`@shoushang/*` 是本项目工作区包，不是外购模板或第三方 UI 框架。CSS 自编；未使用 Bootstrap、Element、Ant Design、shadcn/ui、现成网站模板、外部图标库或运行时字体服务。作品 SVG 由统一渲染器生成，Canvas 仅承担最终 PNG 合成。

## 字体与派生文件

作品卡使用本地 Noto Sans SC Regular OpenType 2.002（原二进制名表 `2.002;GOOG;NotoSansSC-Regular;ADOBE`），Adobe 2014–2020 版权；上游随附 OFL 文字版权区间为 2014–2021。原件来源见 `packages/artwork-exporter/src/fonts/SOURCE.md`，许可全文为同目录 `OFL.txt`，SIL Open Font License 1.1，保留名称为 `Source`。

本项目将该原件派生为 208 个本地无损 WOFF 分片，名称使用 `Shoushang Card Sans / ShoushangCardSans` 避开保留名称，继续遵守 OFL 1.1并保留版权和许可记录。来源、命名、处理方式、字符与变体覆盖边界见 `DERIVATION.md`；原件和所有输出的哈希见 `generation.json`。随应用分发字体须同时保留来源、版权与 OFL，不能将字体单独销售。字体许可不要求导出的 PNG 作品也采用 OFL。

字体重建是完整开发仓库的维护操作，使用既有 Python 3.13.10、FontTools 4.62.1及 zlib；精简交付包已经带有可用分片，不需要 Python、FontTools 或 `tests/m14/build-card-font.py` 才能构建、运行或导出。未覆盖 emoji 和部分稀有字不能描述为已覆盖，界面会提示检查预览。

## 传递依赖及原生库许可

不能将所有传递依赖统称为 MIT。本次 Windows 安装的 `pnpm licenses list --json` 可读到 MIT、Apache-2.0、ISC、BSD-3-Clause、0BSD 和 `Apache-2.0 AND LGPL-3.0-or-later`。例如 Fastify 的 `fast-uri`、`light-my-request`、`secure-json-parse` 为 BSD-3-Clause；`fastq` 为 ISC；`tslib` 为 0BSD。精确版本和平台可选包以本包锁文件及实际安装结果为准。

`@img/sharp-win32-x64` 0.35.5的上游包声明 `Apache-2.0 AND LGPL-3.0-or-later`，内含 libvips 8.18.7。其 `README.md`、`LICENSE`、`versions.json` 继续列出各原生库和许可，包括 libvips、glib、fribidi、libexif、libheif、librsvg、pango、proxy-libintl 的 LGPL 条件，cairo 的 MPL 1.1，以及图像编解码、字体和压缩库各自的 MIT/BSD/zlib/IJG/专门许可与 AOM 专利条款。不同操作系统安装的平台包可能不同，不能把 Windows 清单当所有平台的完整清单。

交付压缩包不内嵌 `node_modules` 或上述原生二进制，由 pnpm 按冻结锁文件取得原上游包。安装后应保留依赖包内的 LICENSE、COPYING、NOTICE、README 及相应源码/再分发说明；后续若打包原生二进制或制作独立安装器，需按实际平台一并交付这些通知及适用的源码提供、替换/重链接等许可义务。不能仅保留本页后删除上游通知。

可在安装后分别检查生产依赖与全部开发工具：

```powershell
pnpm licenses list --prod --json
pnpm licenses list --json
pnpm audit --prod --json
pnpm audit --json
```

许可证枚举和漏洞审计是两种检查。生产 API 可达的 Fastify/sharp 风险、构建开发工具风险和未启用测试服务的风险须分别记录；锁文件和本页均不意味着“零漏洞”或用户已接受风险。实际本轮审计结果见最终交接及对应证据。

2026-10-23精确升级后重新执行 `pnpm audit --json` 和 `pnpm audit --prod --json`，两者均退出0、已知公告数为0。默认受限网络的两次执行先返回 `fetch failed`，随后按环境审批原命令重跑取得结果；没有把网络失败记为审计通过。结果只代表本次锁文件与注册表已知公告，不保证未来公告或所有部署配置安全。原始结果、无私有路径摘要和全量/生产许可清单位于原仓库 `docs/qa/evidence/v1-initial-20261023/`；证据不随交付包分发，兼容回归结果由最终交接单列。

## 文化图片及历史说明

第三方展品图、来源、许可链接与修改说明单列在 `docs/content/ATTRIBUTION.md`、`media-rights.md` 和素材 manifest；软件许可不覆盖这些图像。当前 E-R17采用 CC BY-SA 3.0，E-R18/E-R19采用 CC BY 3.0 TW，须按记录履行署名及适用的相同方式共享条件。匿名版保留第三方署名和字体版权。

M01曾使用 Fastify 5.6.2，M14验收阶段曾使用5.12.5；这些均是历史阶段。当前交付使用 Fastify 5.12.6、sharp 0.35.5、实际 SQLite、媒体管理和本地派生字体。5.12.6是针对 `GHSA-389g-gv7q-r4x8` 的精确补丁升级，没有批量升级其他生产依赖。

V1本轮修复前的 Vitest 3.2.4、concurrently 9.2.1组合审计为生产0、全量 moderate3/high1/critical4，涉及 Vitest/mock 服务、tinypool 和 shell-quote；这是升级前历史结果。只将 Vitest 升至3.2.6不能覆盖后续 mock 公告。当前精确升级至 Vitest 4.1.12、concurrently 9.2.5，并保留 Node24.19及 Vite7.3.7兼容范围；没有执行不加判断的 `audit fix` 或批量升级。修复后审计和兼容测试必须使用新结果，历史交接中的版本与告警数量不得冒充本轮结果。
