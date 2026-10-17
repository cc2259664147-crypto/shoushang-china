# 《手上中国》模块协作规则

本代码根目录的规则适用于所有后续 AI 会话。需求基线是上一级目录的《手上中国_产品需求文档_V1.0.md》，已完整阅读。原始资料和 sources/ 不属于代码修改范围。

1. 模块会话只能修改 docs/tasks/Mxx.md 的“负责目录”明确指定的文件；交付记录可写自身 docs/handoffs/Mxx.md。接手前阅读任务、契约和现有代码。
2. packages/contracts、全局样式、路由/组合根 apps/web/src/app、前后端启动入口、根配置、所有依赖清单和 pnpm-lock.yaml 由总控维护。模块有需要先提交建议，不自行安装依赖。
3. 跨包只能通过 @shoushang/* 的公开入口导入；禁止引用其他包 src/ 内部文件；包 exports 仅公开根入口。包内可使用相对引用。
4. 依赖单向、无循环。生产依赖方向见 docs/architecture/module-boundaries.md；测试工具允许依赖 fixtures，fixtures 仅依赖 contracts。
5. contracts 不依赖 React、浏览器 API 或后端框架；独立 ES2023 类型检查必须通过。
6. papercut-core 为纯逻辑，不负责 UI、存储、网络、导出；不得引入 DOM、React 和系统时钟等隐式副作用。
7. artwork-renderer 使用统一 Work 数据，只读输入，不修改作品；模板版本必须兼容，未知版本明确报错。
8. local-repository 不包含页面逻辑；IndexedDB 事务成功才可显示已保存。
9. artwork-exporter 复用 artwork-renderer，不另写剪纸算法；Canvas 只承担最终合成和 PNG 输出。
10. 页面通过 ContentClient 访问内容，不直连数据库；访客本地作品不自动进入公开展馆。
11. 公共契约需要变化时，在 docs/contracts/change-requests.md 记录原因、受影响模块、迁移和兼容方案，由总控处理后再实现。
12. 不得用假保存、固定成功响应、装饰性按钮冒充已完成业务。内存实现只供测试，刷新后丢失；mock 必须标识；未实现接口不挂成功路由。
13. 严格 TypeScript，不使用 any、@ts-ignore、关闭严格选项绕过错误。自编 CSS，不用 Bootstrap、Element、Ant Design、shadcn/ui 或现成网站模板。
14. 不虚构真实传承人、采访、荣誉或文化事实；不用未授权网络图片；公开 DTO 不得带凭据、passwordHash、proofRef 或内部许可地址。
15. 交付说明记录实际修改、输入输出、检查命令及结果、局限、待集成事项。只有总控可整合路由、依赖和跨模块变更；不得自动开展下一任务。

当前阶段：M01 完成后停止。M02 仅作技术验证，不等于正式工坊开发。M01-M14 是工程模块编号，区别于 PRD 中 M1-M6 日历里程碑。
