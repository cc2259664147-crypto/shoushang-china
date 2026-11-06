# M11 首页

公开入口为 `HomePage({ client, navigate, workshopHref? })`。生产 App 注入现有
ContentClient，精选由 getHome 取得；页面不导入 fixtures。首屏和两个主入口不等待内容。
自制 SVG 为静态数字视觉，不代表真实传统作品。没有音频或开场动画。

浏览器验证：`pnpm exec playwright test --config apps/web/src/features/home/playwright.config.ts`。
确定性内容只在 stories/testing.tsx 中，详见 M11 交接。

回归测试需要保护固定路径截图时，可在当前测试进程设置以下环境变量后运行原套件：

- `M11_EVIDENCE_RUN`：本目录 evidence 内一个新的绝对输出目录。
- `NODE_OPTIONS`：`--require="C:/.../apps/web/src/features/home/preserve-evidence.cjs"`
  （Windows 使用正斜杠路径）。

该预加载器仅把项目 evidence 目录中的 PNG 写入重定向到新输出目录的 screenshots 下，
不改业务、用例、断言或原截图。报告另用 Playwright 的 --output、--reporter 与
PLAYWRIGHT_JSON_OUTPUT_FILE 指定新位置。运行结束应核对接手时证据哈希。
