你负责《手上中国：非遗技艺数字工坊》M02：剪纸技术验证。仅在 C:\Users\mmcn\Desktop\shoushang-china\shoushang-china 工作，不修改上级需求资料或 sources/。

先完整阅读 AGENTS.md、docs/tasks/M02.md、docs/handoffs/M01.md、docs/contracts/data-model.md、docs/contracts/module-api.md，以及上一级 Markdown PRD 中剪纸、恢复与导出要求。检查现有文件，保留已有内容。

本阶段只允许修改 prototypes/papercut-verification/ 和 docs/handoffs/M02.md。所有依赖清单、锁文件、contracts、全局样式、路由和正式模块由总控维护；需要公共变更时给出具体提案，不越权修改。使用当前已安装工具与严格TypeScript、自编CSS、SVG和Canvas，不全局安装工具。

在隔离原型中验证归一化单位方纸上的三角、圆/椭圆、水滴剪切，至少两类对称方式、合法区域/边距/尺寸判断、非法操作不入历史、30步撤销重做、撤销后新增清redo和100切口上限。prototype使用M01统一Work/TemplateVersion/CutOperation，渲染不修改数据，SVG预览与Canvas生成的1600×2000不透明PNG复用同一几何结果；保留模板快照后修改外部模板不能改变旧作品外观。

明确给出水滴贝塞尔公式、对称基础域与变换顺序、边界距离算法和geometryVersion=1冻结建议；先出证据再由总控决定合入正式核心。记录至少50/100操作的测试环境和响应/导出耗时，检查可行的触控/键盘替代操作。真机没有实测必须明确写未验证，不能用桌面模拟冒充。

完成相关验证，在docs/handoffs/M02.md提供实际文件、启动方法、样例/截图或PNG、测试与性能证据、已知几何限制、公共契约建议和M04/M06接手条件。根Vitest目前不自动扫描prototype，验证脚本应放在授权目录并记录明确运行命令。不要实现真实IndexedDB、正式首页/工坊/展馆/后台，不用占位结果冒充已验证。完成M02后停止。
