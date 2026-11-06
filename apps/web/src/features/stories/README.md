# M11 故事

公开入口为 `StoriesPage({ client, url, navigate })`，接入 `/stories` 和 `/stories/:id`。
列表通过 listStories/listCrafts 读取，每页 12 条，工艺和页码保存在 URL；详情直接
getStory 读取。无来源人物与经历不由页面补写，少于三个经历节点使用普通记录排版。

重新核验、ID/查询变化时撤下旧内容，并忽略迟到响应。事实来源和图像许可分开呈现。
关联展品与模板逐 ID 核验；模板复用 gallery 公开的 templateSupported 进行 core 支持检查。
返回地址只允许合法的站内故事列表，列表返回恢复位置与焦点。

testing.html/testing.tsx 是隔离适配器，明确标识合成测试人物和经历，生产 App 不导入。
URL 单测位于 query.test.ts；页面验证位于 home/m11.spec.ts；范围及验收结果见
docs/handoffs/M11.md。
