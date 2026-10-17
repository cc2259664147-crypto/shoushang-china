# 第三方依赖、用途与许可

直接依赖均使用精确版本；完整传递依赖见 pnpm-lock.yaml。锁文件不等于安全审计报告；正式发布阶段复查漏洞及许可证。M01 使用已发布的稳定版本组合，未追随全部最新主版本。pnpm 工作区配置仅允许 esbuild 的必要平台校验脚本，不全局安装。

| 依赖 | 版本 | 用途 | 许可 |
| --- | --- | --- | --- |
| Node.js | 24.19.0 | 受管理运行时，24 LTS | MIT（附第三方通知） |
| node:sqlite / SQLite | 3.53.3（随 Node） | 后续真实内容数据库；目前仅内存引擎探测 | Node MIT / SQLite Public Domain |
| pnpm | 11.25.0 | 受管理 workspace 包管理 | MIT |
| TypeScript | 5.9.3 | strict 类型检查 | Apache-2.0 |
| React / react-dom | 19.2.0 | 前端运行与DOM挂载 | MIT |
| Vite | 7.3.7 | 开发与前端构建 | MIT |
| Fastify | 5.6.2 | Node服务及health | MIT |
| Zod | 4.1.12 | DTO及输入运行时校验 | MIT |
| Vitest | 3.2.4 | 核心/契约/适配器测试 | MIT |
| @playwright/test | 1.56.1 | 后续核心流程E2E，M01只配置 | Apache-2.0 |
| tsx | 4.20.6 | API TypeScript开发运行 | MIT |
| esbuild | 0.25.11 | API打包及底层转换 | MIT |
| concurrently | 9.2.1 | 同一命令启动前后端 | MIT |
| @types/node | 24.10.0 | Node类型 | MIT |
| @types/react / @types/react-dom | 19.2.2 | React类型 | MIT |

不使用 Bootstrap、Element、Ant Design、shadcn/ui、预设样式组件或现成网站模板。所有 CSS 自编；SVG 是统一作品渲染方向，Canvas 仅用于最终PNG；当前示意SVG由项目原创并以CC0提供，不是未经授权网络图片。没有下载文化素材或外部字体。内存仓储不依赖浏览器，IndexedDB 留给 M05；不引入假数据库业务。
