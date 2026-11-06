# 专业剪纸编辑器 v2 架构设计

状态：M15-0 提案，待总控批准后方可实现。日期：2026-10-23（Asia/Shanghai）。本文中的 v2 类型、命令、数值限额和版本号都不是已实现契约。

## 1. 设计原则与明确结论

1. 自由剪刀采用**闭合套索剪切**。第一版不支持开放式刀路，因为开放线无法唯一决定剪除区域；也不模拟实体纸张剩余部分是否连通。
2. 保存数据只使用归一化纸张坐标 `[0,1]²`；CSS 像素、devicePixelRatio、缩放和平移永不进入 Work。
3. v1 与 v2 是显式版本分支，不在原位重解释。v1 继续按 v1 schema/geometry/renderer 打开、渲染和导出；编辑自由路径必须“另存为 v2”。
4. core 是唯一的路径规范化、几何校验和历史权威。UI 只采集有序原始纸张坐标并提交 `FreehandCandidateV2`，不得实现去重、RDP、量化、自交或域校验；renderer 只消费 core geometry；exporter 只消费 renderer SVG；UI 不直接改 `state.work.operations`。
5. 自由路径在 mask 中是真正黑色闭合 path。每个切口单独绘制到亮度 mask，黑色覆盖黑色，因此重叠保持镂空并集，不使用会把重叠填回的复合 even-odd 路径。
6. 首选零新增生产依赖。v2 第一阶段的 RDP、线段相交、点在凸多边形内和仿射变换均可在现有纯逻辑核心中小规模、确定性实现。

## 2. 用户交互状态机

### 2.1 编辑器顶层状态

```text
no-work
  └─ choose/open → ready(tool=select, view=folded)

ready
  ├─ choose tool → ready(tool=select|freehand|circle|triangle|teardrop|pan)
  ├─ begin freehand → drawing-freehand
  ├─ drag selected cut → moving-cut
  ├─ begin pan/pinch → navigating-view
  ├─ save → saving → ready | save-error
  └─ destructive action → confirming-clear
```

候选轨迹、闭合预览、选框、hover 和 viewport 都是 UI 状态，不是 Work，也不写历史或草稿。只有 core 接受命令后，创作状态才改变并触发草稿调度。

### 2.2 自由剪刀状态机

```text
idle
  └─ pointerdown(primary, inside paper, freehand active) → drawing
drawing
  ├─ pointermove/coalesced events → append raw points; rAF updates visible trail
  ├─ Escape | pointercancel | lost capture → cancelled → idle
  ├─ second touch appears → cancel stroke, then navigation gesture
  └─ pointerup → closing-preview → validating
validating
  ├─ valid → core dispatch(add-freehand-cut raw candidate) → committed → idle
  └─ invalid → rejected(reason, frozen preview) → idle after acknowledgement/new stroke
```

- `pointerdown` 取得 pointer capture，记录纸张坐标起点。主鼠标键、笔尖和单指触摸才可开始；右键不开始，笔橡皮端不映射为剪切。
- `pointermove` 优先读取 `getCoalescedEvents()`，但只做坐标映射、按到达顺序追加原始候选和 rAF 视觉缓存。UI 不去重、不简化、不量化。每个动画帧最多更新一次轨迹，不执行完整 Work 校验或全量 SVG 重建。
- 绘制期间始终显示：实线已采样轨迹、明显起点标记，以及从当前末点到起点的虚线闭合边和“松开以闭合”提示。这是自动闭合发生前的可理解预览。
- `pointerup` 冻结轨迹和闭合边，显示“正在校验闭合区域”，把完整 `FreehandCandidateV2` 交给在专用 Web Worker 中运行的 core v2 dispatch。worker 内由 core 一次完成原始路径校验、规范化、规范化后校验和历史提交；UI 不能先显示成功孔洞再回滚，也不能把自行处理的点伪装成 core 结果。
- Escape、`pointercancel`、`lostpointercapture`、切换工具、切换作品/模板和第二触点加入均取消本次绘制；作品、undo、redo、revision 不变。
- 点数不足、过小、非有限坐标、越界、自交、越过真实纸边/基础域/allowedRegion、模板禁用或任何上限错误均拒绝，保留当前作品和历史，具体指出原因及建议（如“轮廓相交，请避免交叉”）。

### 2.3 选择、移动和形状工具

- `select`：单击按可见层级从最高 `order` 向下命中；重复单击同一点在重叠候选间循环，Escape 清除选择。选择状态以描边、控制提示和文本共同表达。
- 拖动选中切口只显示候选位移；pointerup 后发出一次 `update-cut`。Escape/cancel 还原候选，不产生历史。v2 第一阶段只支持整体移动，不支持自由路径逐点编辑、缩放或旋转手柄。
- circle/triangle/teardrop 保留候选放置与参数面板；确认后发 `add-parametric-cut`。切换形状会取消未提交候选，不清除已有作品。
- Delete/Backspace 在画布焦点且不处于文本输入时删除选中切口；调用 `delete-cut`。清空全部切口必须经过模态确认并调用 `clear-cuts`。

### 2.4 输入与手势冲突规则

| 输入 | 选择/形状/自由剪刀 | 视图导航 | 冲突处理 |
| --- | --- | --- | --- |
| 鼠标 | 主键选择、放置、绘制或拖动 | Space+主键、鼠标中键、Pan 工具拖动；滚轮缩放 | Space/中键导航优先；右键保留浏览器菜单 |
| 触控笔 | 笔尖等同主键，pressure 仅可作视觉反馈、不保存 | Space+笔或 Pan 工具 | barrel/eraser 不剪切；cancel 立即丢弃候选 |
| 触摸 | Freehand 下单指绘制；其他工具单指选择/放置 | 双指平移/缩放；Pan 工具单指平移 | 绘制中第二指加入时先取消当前笔画，再进入双指导航 |
| 键盘 | 工具快捷键、方向键移动、Delete、Escape、undo/redo | `+`/`-`/`0`，按住 Space 临时平移 | 文本框内不劫持字母/Delete/undo；模态框捕获焦点 |

触摸双击不用于关键功能；浏览器页面缩放仍可用，编辑器内部 pinch 只在画布区域且双指时生效。`touch-action` 应按工具/手势控制，不能让整个页面在窄屏无法滚动。

## 3. 工具状态机与工具栏信息架构

### 3.1 工具状态

`activeTool = select | freehand | circle | triangle | teardrop | pan`，同一时刻恰有一个持久工具。按住 Space 临时进入 pan，松开恢复先前工具。切换工具必须结束 hover，取消未提交轨迹/移动候选，并保留已提交 Work。

工具按钮使用 `aria-pressed`、图标、文字和高对比边框/底色共同表示选中，不能只用颜色。禁用按钮仍应可聚焦或由相邻说明提供原因；推荐 `aria-describedby` 指向可见/读屏原因。

### 3.2 桌面布局

- 顶部主栏：选择、自由剪刀、圆形、三角形、水滴形；分隔后为撤销、重做、删除、清空；右侧为折叠/展开、保存草稿、完成作品。
- 画布下方/右下视图栏：缩小、只读缩放比例、放大、适配窗口、Pan。缩放范围建议 25%～800%，按钮按固定级距，滚轮以指针为锚。
- 右侧属性栏：当前工具说明、选中切口信息、参数化候选数值和错误原因。自由路径 v1 不提供逐点面板。

### 3.3 移动/窄屏布局

- 390px/360px 下画布优先，底部固定两行或可横向滚动的工具托盘；常用工具（选择、自由剪刀、撤销、重做）始终首屏可达。
- “更多”抽屉容纳三种形状、删除、清空和视图项，但保存草稿/完成作品保持清晰可达，不藏在不可发现的 hover 中。
- 所有交互目标最小 44×44 CSS px，托盘不遮挡画布关键区域；页面其余部分仍能纵向滚动。

### 3.4 禁用条件

| 控件 | 禁用条件与原因 |
| --- | --- |
| 自由剪刀 | 无作品、展开视图、模板未允许 freehand、达到操作/点数上限、正在保存/切换作品 |
| 三种形状 | 无作品、展开视图、模板没有对应 allowedCuts、达到操作上限 |
| 撤销/重做 | 对应历史为空或正在执行互斥存储/切换；原因“没有可撤销/重做的编辑” |
| 删除 | 未选择切口、正在绘制/移动、展开只读预览 |
| 清空 | 切口为零、正在绘制/移动；点击后仍需二次确认 |
| 折叠/展开 | 无作品或 renderer 正在处理不可取消的当前提交；当前视图按钮作为选中而非禁用 |
| 缩小/放大 | 达到 25%/800% 或无画布；fit 仅无画布时禁用 |
| 保存草稿 | 无作品、无存储连接、无新改动、冲突阻塞或正在保存 |
| 完成作品 | 无作品、当前候选未提交、校验失败、存储不可用/冲突或正在保存/导出 |

### 3.5 快捷键与焦点顺序

- `V` 选择，`F` 自由剪刀，`E` 圆形，`T` 三角形，`D` 水滴形，`H` Pan。
- `Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 和 Windows 的 `Ctrl+Y` 重做。
- Delete/Backspace 删除选中；方向键每次移动 `0.001` 纸张单位，Shift+方向键 `0.01`，每次连续 keydown 会话在 keyup 合并为一个 `update-cut` 历史步骤。
- `+`/`=` 放大，`-` 缩小，`0` 适配窗口；Space 按住临时 Pan；Escape 取消候选/绘制/拖动或关闭最上层非破坏弹窗。
- 快捷键只在画布/编辑器作用域生效；输入框、select、contenteditable 和模态框文本交互不拦截。
- 焦点顺序：页面标题/返回 → 主工具 → 画布 → 视图工具 → 属性 → 历史/删除 → 保存。打开清空确认后焦点进入标题/取消/确认的陷阱；关闭后回到“清空”。危险确认按钮使用“清空全部切口”，不以“确定”模糊表达。

## 4. 坐标变换

保存空间 `P=(x,y)` 为归一化纸张坐标。画布 CSS 内容框为 `(W,H)`；`base=min(W,H)`；适配基准左上角 `O=((W-base)/2,(H-base)/2)`。viewport 为 `zoom` 和 CSS 像素平移 `pan=(px,py)`：

```text
screen(P) = O + pan + zoom * base * P
paper(S)  = (S - O - pan) / (zoom * base)
```

- fit 设置 `zoom=1, pan=(0,0)`；zoom 以当前指针/画布中心为锚修正 pan，使锚下纸张点不跳动。
- viewport 最终平移可限制为至少 10% 纸面仍可见；限制规则只作用 UI，不截断保存坐标。
- hit-test 的 CSS 容差（鼠标 6px、touch/pen 12px）经逆变换换算为纸张单位；这些是交互容差，不得复用为几何合法性容差。
- DPR 只用于 Canvas/光栅清晰度。DOM/SVG 逻辑尺寸、PointerEvent client 坐标和保存点始终以 CSS px→paper 变换处理。
- viewport 是会话临时状态；不写 Work、core 历史、revision 或缩略图。若以后持久化偏好，必须放在独立 UI preferences store。

## 5. v2 数据结构提案

以下伪类型用于评审，不等同于当前 contracts：

```ts
type ParametricCutV2 = {
  kind: 'parametric';
  id: Id; order: number; parameterVersion: 2;
  shape: 'circle' | 'triangle' | 'teardrop';
  center: Point01; width: number; height: number; angleDeg: number;
};

type FreehandCutV2 = {
  kind: 'freehand';
  id: Id; order: number; parameterVersion: 2;
  points: readonly Point01[]; // 隐式按最后一点回到第一点闭合，不重复末点
  closed: true;
};

type RawPoint = { x: number; y: number }; // 瞬态有限 number，可在合法纸域外以便 core 明确拒绝
type FreehandCandidateV2 = {
  id: Id;
  order: number;
  rawPoints: readonly RawPoint[]; // 按采样顺序，3～当期 rawMaxPoints；不进入 Work
};

type CutOperationV2 = ParametricCutV2 | FreehandCutV2;
type EditorProfileV2 = {
  profileId: Id;
  profileVersion: number; // 同一 profileId 下只追加的正整数不可变版本
  profileSchemaVersion: 2;
  sourceTemplate: { id: Id; version: number; snapshotSha256: string };
  allowedTools: {
    parametric: readonly ('circle'|'triangle'|'teardrop')[];
    freehand: { enabled: boolean; minArea: number; minPerimeter: number; maxPoints: number };
  };
  maxTotalFreehandPoints: number;
  geometryVersion: 2;
  rendererVersion: 2;
};

type WorkV2 = Omit<WorkV1, 'operations'|'schemaVersion'> & {
  operations: readonly CutOperationV2[];
  schemaVersion: 2;
  templateSnapshot: TemplateVersionV1; // 原始内容模板快照，id+version及字段均不改写
  editorProfileSnapshot: EditorProfileV2; // 独立、完整、不可变的编辑器能力快照
};
type AnyWork = WorkV1 | WorkV2;
```

### 5.1 v2 编辑器配置来源

M15 选择“**v1 来源模板快照 + 独立 `editorProfileSnapshot`**”，不要求服务器或内容 API 发布 TemplateVersionV2，也不把现有模板伪装成新内容版本。

- 应用随版本内置一份经总控批准、**只追加不改写/删除历史项**的 `EditorProfileV2` 注册表。不可变身份是 `profileId+profileVersion`；同一 profileId 的规则变化必须追加更高 profileVersion。注册项把不可变 `profile` 与生命周期元数据分开：`newWorkEnabled` 控制新建/另存，`historicalMode:'editable'|'read-export-only'` 控制旧作品是否仍可编辑。注册表只为明确列出的正式 v1 模板提供配置；键还包含 source template `id+version+canonical snapshot SHA-256`。snapshot digest 对严格 `TemplateVersionV1Schema.parse` 结果按 RFC 8785 JSON Canonicalization Scheme 序列化后的 UTF-8 字节计算；实现、黄金字符串和浏览器/Node 摘要必须一致，不使用普通对象插入顺序或本地化排序充当规范。
- 新建 v2 作品时，内容 API 仍返回原 `TemplateVersionV1`。应用必须将返回快照按 contracts 定义的规范 JSON 规则计算 SHA-256，并与注册表三元键精确匹配；无匹配、字段被改写或 profile 未启用时，只能按 v1 新建/查看，不能显示自由剪刀已可用。
- `WorkV2.templateSnapshot` 原样保存 v1 内容快照；`editorProfileSnapshot` 保存当时匹配到的**完整不可变 profile 值**。创建/另存边界要求对应注册项 `newWorkEnabled=true`；停用只把它改为 false，绝不删除/改写 profile 值，也不阻止历史读取。恢复边界按 `profileId+profileVersion` 找到历史项，验证嵌入的完整 `editorProfileSnapshot` 与注册表 profile 深值一致，并用 Web Crypto/等价 SHA-256 复核 source template id/version/digest，之后才建立 core 状态；不能只核对几个 ID/版本字段。
- 历史打开不访问服务器。`historicalMode='editable'` 且旧 core 命令语义仍受支持时可继续编辑；`read-export-only` 时至少允许基于嵌入的 template/profile 快照打开、折叠/展开、缩略图和 PNG 导出，但禁用创作命令并解释原因。真正不存在的 `profileId+profileVersion`、完整快照不一致或未知 geometry/renderer/parameter 版本才返回 `UNSUPPORTED_VERSION`/损坏错误并保留原记录；“当前禁止新建”不得被当作历史作品损坏。
- 首批三个正式模板是否全部允许 freehand，必须在 CR-M15-01 审批时逐项列出 profileId、源模板 id/version/digest 和规则；没有审批项就没有可新建的 v2 模板。
- 这不修改内容服务器、正式数据库或 TemplateVersionV1，也不会复用同一 template `id+version` 偷加字段。未来若内容系统正式发布 v2 模板，应另提 CR 和迁移矩阵，不能静默替换本地 profile。

EditorProfileV2 的模板级数值只能收紧平台限额，不能放宽；`templateSnapshot.rules.maxOperations<=100` 继续适用，实际操作上限取内容模板与 editor profile/平台的更小值。

### 5.2 数量、精度和硬上限

| 项目 | v2 平台值 |
| --- | ---: |
| 单次原始会话采样点暂定上限（不持久化） | 4096，须经 M15-5 Worker 浏览器验证后批准 |
| 单条保存自由路径点数 | 最少 3、最多 512 |
| 单作品保存自由路径总点数 | 最多 20,000 |
| 全部切口操作数 | 最多 100，模板可更低 |
| 坐标量化 | `round(value * 1_000_000) / 1_000_000` |
| 持久化坐标规范 | 有限 number、`[0,1]`，且必须严格等于六位量化结果 |

超过当期原始点上限时立即停止追加并取消/拒绝本次笔画，提示“轨迹过长，请分成多个切口”，不能静默截断成不同形状。4096 是设计候选值，不在 M15-1 冻结为发布承诺：M15-2 做算法基准，M15-5 完成有状态 Worker 的真实浏览器/设备档位测试，总控必须在 M15-6 写入首个正式 v2 持久作品前最终批准 rawMaxPoints；M15-7 再做回归压力确认。保存数据不含 pressure、tilt、时间戳、pointerId、屏幕坐标或闭合预览线。

JSON/structured clone 解析后无法区分 `0.1` 与 `1e-1`，因此 schema 不尝试拒绝指数**写法**。它只接受有限 JavaScript number，验证范围与六位量化等值；系统序列化器统一输出规范 number，不以原始词法作为安全边界。字符串坐标仍因类型错误拒绝。

### 5.3 版本策略

- v1：`schemaVersion=1`、`geometryVersion=1`、`rendererVersion=1`、`parameterVersion=1`，严格走现有实现。
- v2：`Work.schemaVersion=2`、operation `parameterVersion=2`、`editorProfileSnapshot.profileSchemaVersion=2`、editor geometry/renderer version=2；profileVersion 是只追加的内容配置版本，不固定等于2。原 `templateSnapshot` 仍是未修改的 TemplateVersionV1（其中 v1 版本字段保持1），不得把内容模板版本改成2。参数化 v2 明确带 `kind:'parametric'`，其形状公式在 editor geometry v2 中调用经黄金测试冻结的 v1 公式；自由路径带 `kind:'freehand'`。
- 不允许 `schemaVersion=2` 内混入 parameterVersion=1，也不允许仅修改版本数字而不做结构转换。
- 未知正整数版本返回 `UNSUPPORTED_VERSION`；结构损坏返回 `INVALID_INPUT`。任何失败都保留原始记录并允许原始备份。

### 5.4 v1 只读与“另存为 v2”

- v1 可正常打开、折叠/展开、生成缩略图和 PNG；默认只读，避免新编辑器悄悄改变旧几何。
- 用户选择“另存为可编辑副本”后，先用 v1 templateSnapshot 的 id/version/规范摘要查找已批准本地 profile；匹配后创建新 work ID、`schemaVersion=2`，原样复制 v1 `templateSnapshot` 并嵌入完整 `editorProfileSnapshot`。每个 v1 参数切口转换成 `kind:'parametric'`、parameterVersion=2，数值原样复制并经 v1/v2 双几何黄金对比确认。
- 原 v1 记录及其 revision/缩略图始终不改。v2 新记录以 create-only `expectedRevision=null` 原子保存；新记录成功后才导航到副本。
- 若当前模板没有精确匹配的已批准 editor profile、转换/几何对比失败、配额不足、事务回滚或 ID 冲突，则不创建/不展示成功副本，继续保留并可查看/导出原 v1。
- 不提供原位“升级”；未知版本也不尝试另存转换，只允许备份。

### 5.5 版本兼容矩阵

| 输入记录 | 打开/查看 | 编辑 | SVG/PNG | 保存策略 | 失败保护 |
| --- | --- | --- | --- | --- | --- |
| 合法 v1 四版本均为1 | 支持，走冻结 v1 分支 | 原记录只读；有精确 profile 匹配才可显式另存 v2 | 支持，继续 v1 geometry/renderer | 新 ID create-only v2 副本 | 转换失败保留 v1，不产生半成品 |
| 合法 v2，历史 profile 项仍为 editable | 支持，完整 profile 深值/source digest 核验 | 支持 M15 工具/命令 | 支持，共享 v2 geometry→renderer | 原 revision/CAS 草稿与完成版流程 | newWorkEnabled=false 也不影响旧作品 |
| 合法 v2，历史 profile 项为 read-export-only | 支持，只读打开 | 禁止并解释旧编辑语义已停用 | folded/unfolded/缩略图/PNG 必须支持 | 不写创作变更，可导出备份 | 不把停用误报为损坏 |
| 真正未知 profile/算法版本或嵌入 profile 与注册项深值不一致 | 拒绝猜测 | 拒绝 | 不按新算法替代 | 不迁移、不覆盖 | `UNSUPPORTED_VERSION`/损坏提示，inspect+原始备份 |
| v2 schema 混入 v1 operation/版本 | 拒绝 | 拒绝 | 拒绝 | 不写入 | `INVALID_INPUT` 或明确的 `UNSUPPORTED_VERSION`，可备份原始值 |
| 未知 schema/geometry/renderer/parameter 正整数 | 不猜测渲染 | 拒绝 | 拒绝 | 不迁移、不覆盖 | `UNSUPPORTED_VERSION`，inspect+原始备份 |
| 缺字段、NaN/Infinity、超点数或损坏记录 | 不作为可用作品展示 | 拒绝 | 拒绝 | 不修复时静默写回 | `INVALID_INPUT`，保留记录并列入 inspect |
| 数据库物理版本高于程序 | 不打开连接 | 不可编辑 | 已有文件不受改写 | 不删除/重建数据库 | `UNSUPPORTED_VERSION`/存储不可用提示，使用兼容程序 |

### 5.6 增量契约与编译稳定性

M15-1 不重定义现有 `Work`、`CutOperation`、`PapercutCommand`、`PapercutCore`、`ArtworkRenderer`、`LocalRepository` 或 `ArtworkExporter`；这些名称继续精确指向 v1，使所有现有实现方保持可编译。M15-1 只新增：

- `WorkV1`/`CutOperationV1` 作为现有类型的显式别名，同时保留原 `Work`/`CutOperation` 导出；
- `EditorProfileV2`、`FreehandCandidateV2`、`CutOperationV2`、`WorkV2`、`AnyWork` 及严格 schema；
- 独立命名的 `PapercutCommandV2`、`PapercutStateV2`、`PapercutCoreV2` 和后续 v2 端口所需基础类型，但不把现有端口参数切换为 `AnyWork`。

M15-2～M15-6 分别通过新增、独立命名的 v2 工厂/接口接入，例如 `createPapercutCoreV2`、`createArtworkRendererV2` 和 v2 repository 扩展；现有 v1 工厂和端口继续回归。M15-7 负责串行集成所有直接实现方。推荐最终仍保留 `Work` 为 v1 兼容别名，新的通用调用点显式使用 `AnyWork`，避免一次全仓破坏性别名切换；如果总控决定切换既有通用别名，contracts 与 core/renderer/exporter/repository/web 的直接实现方必须在 M15-7 同一串行集成变更中完成。

从 M15-1 起，每个子模块交付前必须运行并通过根级 `pnpm typecheck`，不得把编译破坏留给下一个模块。若独立模块无法在保持根类型通过的情况下交付，当前模块应标记阻塞并调整边界，而不是提交中间失配状态。

## 6. 自由路径确定性几何规则

所有数值常量集中在 `FREEHAND_GEOMETRY_LIMITS_V2`，禁止散落魔法数字。建议值：

```text
rawMaxPoints=4096 // 当前性能验证候选；不是持久 schema 常量或已批准发布值
savedMinPoints=3
savedMaxPoints=512
totalMaxPoints=20000
dedupeDistance=0.0005 paper-side
rdpTolerance=0.0015 paper-side
coordinateQuantum=0.000001 paper-side
boundaryEpsilon=0.0000001 paper-side
intersectionEpsilon=0.0000001 paper-side
minimumPerimeter=0.01 paper-side
minimumArea=0.00001 paper-side²
```

模板的 minArea/minPerimeter 可以更严格。持久格式的量化、保存点数、面积/周长等语义须在 M15-1/2 评审并由黄金夹具冻结；`rawMaxPoints=4096` 仅为非持久候选上限，按 5.2 的 M15-5 性能门槛在 M15-6 前最终批准。

### 6.1 提交流程与顺序

1. UI 仅把 coalesced pointer 样本按事件顺序逆变换到纸张坐标，构造 `FreehandCandidateV2`。它可以为了内存安全在超过当期 `rawMaxPoints` 时停止采集并提交“超上限”错误；候选值为4096时即在第4097点触发，但不得删除、去重、clamp、RDP 或量化点。
2. core 检查候选结构、id/order、3～当期 `rawMaxPoints` 个原始点以及每个坐标为有限 number。`rawMaxPoints` 必须由本次构建中同一只读配置同时提供给 UI 采集器和 core，UI 不能自行扩大；正式持久化前可依据 M15-5 证据调低。原始点不得 clamp 到 `[0,1]`，否则越界刀路会被伪造成沿纸边合法。
3. core 依次去除与前一个保留点欧氏距离 `< dedupeDistance` 的连续重复点；不跨序重排。此“去重后原始路径”是第一份权威检查对象，并以末点→首点临时闭合。
4. **在 RDP 之前**，core 对去重后的原始闭合路径执行完整校验：点/每条线段必须位于 `[0,1]²`、基础折叠域和 allowedRegion；对称副本满足真实纸边 minEdgeGap；所有非相邻线段对执行交叉、端点接触和共线重叠检查；重复非相邻点、零长度边、点数/周长/面积/近共线均按同一正式规则拒绝。这里没有“明显自交”或抽样检查。
5. 原始路径通过后，core 对**尚未显式闭合的开放采样序列**运行标准 Ramer–Douglas–Peucker，容差固定为纸张单位 `0.0015`。端点必保留；距离定义为点到有限线段；相等时保留最早索引，确保确定性。
6. core 将坐标量化到 6 位小数，规范化 `-0` 为 `0`；再次去除量化产生的连续重复点。若末点等于首点则移除末点；保存结构以最后点→首点隐式闭合且 `closed:true`。
7. core 对规范化后的闭合路径**再次完整执行第4步全部校验**，并检查保存点数≤512、Work 总自由点数≤20,000 和模板/profile 收紧限额。原始或规范化结果任一失败均拒绝。
8. profile adapter 已完成完整 profile 深值/source digest 核验，并确认该历史项 `historicalMode='editable'`；core 完整 WorkV2/editorProfile 业务校验通过后，才构造 `FreehandCutV2` 并提交一次历史命令。`newWorkEnabled=false` 本身不阻止旧作编辑；任何失败不改变 state、undo 或 redo。

两轮相交检查共用 core 的确定性实现：将每条线段的包围框插入固定 `64×64` 纸张网格，网格坐标和桶内 segment index 按整数/ordinal 顺序处理；只对共享桶的去重线段对执行精确 orientation+on-segment。包围框覆盖其穿越的所有网格单元，因此不会漏掉交点；长线或退化集中数据的最坏情况仍可能退化为 O(n²)，但结果不依赖对象迭代顺序或线程时序。

浏览器在专用 Web Worker 中调用同一个 `@shoushang/papercut-core` v2 dispatch；没有 UI 版算法。验收预算：4096 点最坏夹具从 pointerup 到 core 结果，典型桌面 p95≤250ms、中低端移动 p95≤1000ms；期间主线程连续帧 p95 仍分别≤16.7ms/33.3ms，主线程单个提交相关 long task 不得超过50ms。M15-2 必须记录至少30次原始样本；若真实设备不达标，应在契约冻结前降低 rawMaxPoints 或优化 core，不能跳过原始完整校验、在主线程运行 O(n²) 回退或超时后静默接受。

相同有序原始点、Work/profile 和常量必须得到相同保存点、错误或新状态。worker 超时/崩溃由适配器报告失败，原状态不变；不得把未验证候选写入 Work。

### 6.2 core 原始候选接口

v2 采用“命令接收原始候选并在 core 内原子规范化+提交”为权威写路径：

```ts
type PapercutCommandV2 =
  | { type: 'add-freehand-cut'; candidate: FreehandCandidateV2 }
  // 其他命令略

interface PapercutCoreV2 {
  prepareFreehandCut(work: WorkV2, candidate: FreehandCandidateV2): Result<FreehandCutV2, CoreError>;
  createSession(work: WorkV2): Result<PapercutSessionV2, CoreError>;
}
interface PapercutSessionV2 {
  current(): { work: WorkV2; canUndo: boolean; canRedo: boolean };
  dispatch(command: PapercutCommandV2): Result<{ work: WorkV2; canUndo: boolean; canRedo: boolean }, CoreError>;
}
```

`prepareFreehandCut` 与 session dispatch 内部调用同一个私有规范化函数，供纯逻辑测试、诊断和非提交预检使用；它不授予 UI 自行实现算法的权限。生产提交把 raw candidate 直接交给 session dispatch，dispatch 必须重新/直接完成权威处理，不能信任 UI 传入 `FreehandCutV2`。`PapercutSessionV2` 是显式创建、无 I/O/时钟/随机数的确定性内存会话，只存在于 worker；worker 只是执行位置适配器，不拥有算法。

### 6.3 对称与重叠

FreehandCutV2 的 local geometry 已是基础折叠域中的纸张坐标闭合多边形，可由 core 输出 identity placement 或专用 `paper-loop`；renderer 不重新简化。folded 只绘制原始路径，unfolded 应用同一 `symmetryTransforms`。多个切口或对称副本相交时均作为 mask 中黑色形状叠加，语义为 union。

## 7. 历史命令语义

提案命令：

```ts
type PapercutCommandV2 =
  | { type:'add-parametric-cut'; operation: ParametricCutV2 }
  | { type:'add-freehand-cut'; candidate: FreehandCandidateV2 }
  | { type:'update-cut'; operationId: Id; change: { type:'translate'; dx:number; dy:number } }
  | { type:'delete-cut'; operationId: Id }
  | { type:'clear-cuts' }
  | { type:'undo' } | { type:'redo' }
  | { type:'set-palette'; palette: WorkV2['palette'] };
```

- `add-freehand-cut` 不接受已规范化 operation；core 根据 raw candidate 构造保存对象并原子提交。
- `update-cut` 第一版只接受有限纸张坐标 delta，由 core 平移目标、保持 `id/order/kind` 并重新执行完整几何/Work 校验。UI 不复制或改写自由路径点。以后若增加参数编辑或 replace，须另提命令结构并保持 core 权威。
- `delete-cut` 删除后由 core 重新编号剩余 `order=0..n-1`；`clear-cuts` 原子清空。不存在的 operationId 返回 `INVALID_INPUT`，不是成功空操作。
- 每次有效 add/update/delete/clear/不同配色只产生一个 undo 步骤；拖动期间的视觉候选和键盘自动重复在结束时合并成一次 update。
- update 到完全相同规范值、clear 空作品、相同配色、空 undo/redo 为成功无操作：不增加历史，也不清 redo。
- 无效命令不改变 work、undo、redo；有效新编辑清空 redo。删除、移动、清空均可撤销/重做。
- 历史两个方向继续各最多 30 步，但 v2 **不保存30份完整 Work**。session 内保存不可变 `HistoryEntryV2`：add 记录新增 operation；update 记录同一 operation 的 before/after；delete 记录 operation+原 index；clear 仅持有清空前不可变 operations 数组引用；palette 记录 before/after。operations 和 path 点数组采用 core 私有不可变值及结构共享，命令只复制被修改的 operation/数组脊柱。undo/redo 由 inverse/forward entry 恢复 operations/palette，当前 id/name/template/profile/revision/timestamps/status/schemaVersion 保持。
- v1 命令适配器保留；v1 只读 UI 不向其发编辑命令。UI 永不直接 splice/assign `state.work.operations`。

### 7.1 有状态 Worker 协议

每个打开的 v2 编辑会话拥有一个专用 worker 和唯一随机 `sessionId`（由 web 调用方生成，不进入 Work）。worker 内持有唯一 `PapercutSessionV2`、当前 Work 和私有 undo/redo entries；主线程不持有、发送或接收完整历史数组。

主线程→worker 的唯一业务消息：

```ts
type EditorWorkerRequest =
  | { type:'initialize'; sessionId:string; requestId:number; work:WorkV2 }
  | { type:'dispatch'; sessionId:string; requestId:number; sequence:number; command:PapercutCommandV2 }
  | { type:'get-current-work'; sessionId:string; requestId:number }
  | { type:'dispose'; sessionId:string; requestId:number };
```

worker→主线程只返回：当前确认 Work（initialize/有效 dispatch/get-current-work 时）、`canUndo/canRedo`、当前 sequence、错误和必要的渲染/选择摘要；绝不返回 undo/redo entries。每次命令最多跨线程 structured clone 一份当前 Work，而不是31～61份状态。保存前等待命令队列排空，再取当前确认 Work；IndexedDB 只持久化 Work/草稿元数据/缩略图，不持久化编辑历史。

协议约束：

- 每个 session 主线程维持单一串行 dispatch 队列和单调 `sequence`，同一时刻最多一个命令在途。响应必须同时匹配当前 sessionId、requestId 和期望 sequence；旧会话、重复、乱序或取消后的响应一律丢弃，不能覆盖新作品。
- `initialize` 在 worker 中完整验证一个外部 Work 后创建空历史。其后 session 只接受命令输入，历史 entry 都由 core 自己生成并保持私有不可变；因此每次 dispatch 只验证命令、受影响 operation、候选新 Work 及必要的全局计数/几何，不重新 schema 解析和几何验证30步历史。undo/redo 使用受信的内部 entry，再校验恢复结果的轻量不变量；外部无法注入历史。
- 主线程仅保存 `lastConfirmedWork`（最近一次已应用响应的独立 clone）和 canUndo/canRedo，用于 renderer、自动保存与崩溃恢复；在途候选绝不合并到它。渲染/保存不得读取“乐观”未确认 Work。
- 切换作品/模板先停止发送、使旧 sessionId 失效、请求 dispose 并终止超时未退出 worker，再为新 Work 创建新 worker/initialize。旧 worker 的任何迟到消息都因 sessionId 不匹配被忽略。
- worker `error/messageerror`、意外终止或协议校验失败时，取消所有在途命令且不自动重放（防止重复提交）；用主线程 `lastConfirmedWork` 创建新 worker 并 initialize，undo/redo 清空。UI 明确提示“编辑器已恢复，撤销历史已重置；刚才未确认的操作未保存”，让用户自行重试。
- dispose 后 worker 必须释放 state、history、raw candidate 和网格缓存；页面卸载不依赖异步保存成功。

内存预算以“当前 Work + 最多30个增量 history entries + 一份跨线程 Work clone + renderer 输出”为模型测量，不得按30份 Work 快照掩盖。验收至少覆盖20,000点 Work、30次最大512点 update、clear/undo/redo、palette结构共享，并记录 worker/主线程堆内存；建议编辑会话相关 JS heap 增量桌面≤64MiB、移动档位≤40MiB，超限必须优化或收紧正式限额后再冻结。

## 8. 渲染、缩略图与导出

```text
AnyWork
  → version router
  → core.validate + getWorkGeometry(v1|v2)
  → one WorkGeometry model
  → artwork-renderer folded|unfolded SVG
  → preview / thumbnail / artwork-exporter Canvas→PNG
```

- geometry v2 的自由路径输出闭合有限点数组；参数化形状复用冻结公式。folded/unfolded 只选择对称矩阵数量，不能分叉自由路径算法。
- SVG 生成器只发出固定标签/属性和有限数值。坐标格式最多 6 位小数、`-0→0`，拒绝 NaN/Infinity；用户名称、ID、提示文字均不插入 SVG。
- 每个切口生成独立的黑色 `<path d="M…L…Z">`，默认 nonzero；整个纸域为白色。重叠黑色不会因 even-odd 反转。
- 保留现有嵌入 SVG 图像文档的资源隔离策略，或以浏览器回归证明替代方案不会发生 mask ID 冲突。禁止脚本、事件属性、foreignObject、外链、任意 data URL 和未经转义字符串。
- renderer 在 schema/core 上限之后仍设置输出预算：建议 SVG UTF-8 最大 4 MiB；预计上限 20,000 点（每点约 25–40 字节加复制）应显著低于预算。超限返回明确错误，不生成部分图。
- exporter 继续调用 renderer 的 unfolded 输出；不解析 Work 自己画自由路径。现有 PNG 边界保持 600–4096、总像素≤12M、默认 1600×2000、不透明 sRGB；失败不改作品。

## 9. IndexedDB 兼容与迁移

### 9.1 物理版本决定

推荐**保持物理数据库版本 3**：现有 `works`/`drafts` 使用结构化克隆保存完整 Work，不需要新增 store/index；缩略图/revision/draftRevisions 的物理关系不变。M15-6 若实现时必须新增索引或迁移账本，需另提存储 CR，不能自行升版。

### 9.2 记录判别与事务

- 读取先查看 `schemaVersion`，再调用对应严格 schema 和 core。`1→v1`、`2→v2`；未知/缺失/损坏进入 `inspectRecords`，普通列表不冒充空记录。
- v1/v2 草稿、完成版和缩略图使用相同 workId/revision 规则；单个 workId 的草稿必须与对应完成版 schemaVersion 一致。自动保存不改变完成版，commit 同事务写完成版/缩略图并删草稿。
- revision、expectedRevision、draft revision/baseRevision、高水位和冲突检测完全沿用 v1 语义；v2 不因 schema 升级绕过 CAS。
- v1 另存 v2 使用新 ID 且在一个 readwrite 事务内 create-only；检查 100 件配额、ID 不存在、完整 v2 校验，再写 v2 草稿或完成版和 pending/ready 缩略图。原 v1 不在事务写集合中。
- 未知版本、迁移失败、事务 abort、配额和冲突不得删除/覆盖任何原始记录。`exportRawBackup` 必须能输出其原始结构化值和 Blob。
- 不允许删除数据库、清空 store 或重新初始化作为升级步骤；不修改服务器内容数据库，访客作品不上载。

## 10. 性能与资源预算

| 预算 | 目标/边界 |
| --- | --- |
| 输入反馈 | 典型桌面 rAF 视觉反馈目标 60fps（每帧≤16.7ms）；中低端移动最低 30fps（≤33.3ms） |
| pointermove | 每帧至多一次 React/DOM 可见更新；不做完整 Work 校验、不重建全量 SVG、不写 IndexedDB |
| 单笔提交 | raw 暂定≤4096、saved≤512；worker 中对去重原始路径和规范路径各做一次完整校验；候选4096点桌面p95≤250ms、移动p95≤1000ms，主线程无>50ms提交长任务；M15-5后才批准最终raw上限 |
| 单作品 | ≤100 操作、自由路径总点数≤20,000；展开、undo/redo、缩略图和导出不得崩溃 |
| core 历史 | undo/redo 各30个增量entry并结构共享，不保存完整Work快照；初始化完整验证，dispatch不重验全部历史 |
| SVG | UTF-8≤4 MiB；超限明确失败，不截断；无 DOM 节点无限增长 |
| PNG | 沿用≤12M 像素；默认输出峰值至少按 RGBA 约 48 MiB 加浏览器编码开销规划，移动端失败须可重试且保留作品 |
| Worker/UI 内存 | 当前Work+30增量entry+一份跨线程Work clone；建议桌面相关heap≤64MiB、移动≤40MiB；完成/切换释放raw点、历史、网格缓存、pointer capture与rAF |

验收记录必须包含设备/浏览器/版本、DPR、作品操作/点数、至少 30 次帧样本的 p50/p95/最大值、内存观测方法和原始数据。单次 Playwright 点击毫秒数不能单独证明 60fps。

## 11. 安全与无障碍

- contracts/core 双层拒绝非有限数、负零规范化、超点数、超总点数、未知字段和未知版本；解析前也要限制输入记录大小，避免超大 JSON/structured clone 卡死。
- SVG 只由固定模板和已校验数字组成；不接受用户 SVG path 字符串。用户作品名只进入 Canvas 文本，经现有文件名清理；不进入 SVG。
- pointer 候选在取消/拒绝时彻底释放；错误不回显原始路径 JSON、内部异常或堆栈。
- 工具选择、有效/无效、选中切口均有图标/文字/aria 状态，不只靠颜色。实时错误使用不打断连续绘制的 status；提交拒绝用可聚焦 alert，并把焦点留在画布/工具上下文。
- 画布提供可访问名称、当前工具/缩放/选中对象摘要；所有核心操作有键盘等价。方向键移动路径与 pointer 移动调用同一 update-cut。
- `prefers-reduced-motion` 下取消平滑 zoom/pan 和闪烁轨迹动画，状态变化立即完成；不取消必要的闭合预览。
- 200% 浏览器缩放和 360px 宽度下无被遮挡关键操作、水平页面溢出或小于 44px 目标。

## 12. 测试与验收矩阵

| 类别 | 必须覆盖的场景与预期 |
| --- | --- |
| 产品行为 | 闭合套索实时轨迹→闭合预览→一次提交真实孔洞；开放路径不能保存；三形状保留 |
| 鼠标 | 主键绘制/选择/移动，中键或 Space 平移，滚轮锚点缩放，右键不误剪 |
| 触控笔 | pen pointer 绘制、移动、cancel；pressure 不改变保存几何；橡皮端不误触发 |
| 触摸 | 单指绘制，第二指加入取消笔画并双指 pan/pinch；页面仍可滚动；目标≥44px |
| 键盘 | V/F/E/T/D/H、undo/redo、Delete、方向键合并一步、+/−/0、Space、Escape；输入框不被劫持 |
| 几何合法性 | 少点、重复、近共线、零面积、短周长、自交/接触、raw 越界、简化后越界、上限和非有限数均拒绝且历史不变 |
| 对称展开 | vertical/radial4 的自由路径 folded/unfolded 与 core 矩阵黄金点一致 |
| 重叠镂空 | 参数/自由/对称副本两两重叠区域仍为背景孔洞，不被 even-odd 填回 |
| undo/redo | add/update/delete/clear/palette 各一步；无效命令不变；新编辑清 redo；最多30历史 |
| 删除与清空 | 选中删除、可撤销；清空二次确认、取消不改，确认一次历史并可撤销；order 重排正确 |
| v1 兼容 | v1 只读打开、folded/unfolded、缩略图、PNG 与冻结夹具一致；不自动改版本/坐标 |
| profile 生命周期 | profile新建停用后旧Work仍按完整快照深值核验并可读/导出；editable可续编，read-export-only禁编辑；真正未知版本才失败 |
| v2 保存恢复 | 新建/草稿/完成/刷新/重开；路径点与量化值一致；缩略图 revision 匹配 |
| revision 冲突 | 双标签 v2 草稿/完成/另存竞争仅一个成功；失败保留本地画布，可重载或另存 |
| 存储失败 | 打开/配额/事务 abort/阻塞/versionchange；不显示假成功，不覆盖，原始备份可下载 |
| SVG 渲染 | 真 path/mask、有限数字、无脚本/外链/用户字符串，多实例 ID 隔离，≤4MiB |
| PNG 导出 | 复用 unfolded renderer；默认1600×2000、不透明、孔洞与预览一致；失败可重试不改 Work |
| 宽屏 | 工具、画布、属性三栏可见，焦点顺序和快捷键正确 |
| 390px 窄屏 | 核心流程完整，画布优先、托盘可达、无遮挡/溢出 |
| 360px 窄屏 | 同上；更多抽屉和确认模态可完成，44px 目标 |
| 200% 浏览器缩放 | 关键按钮/错误/模态可见，坐标映射正确，无仅 hover 功能 |
| reduced motion | 无平滑/闪烁动画，功能和闭合预览仍完整 |
| Worker 协议 | initialize/dispatch/get/dispose；20k点不传历史；乱序/重复/旧session响应不覆盖；切换终止；崩溃以lastConfirmedWork恢复、历史清零、未确认命令不重放 |
| 性能上限 | 100 操作+20k点的展开、undo/redo、缩略图、PNG 不崩溃；帧/内存/SVG原始数据留证 |
| 恶意/超大输入 | 4097 raw、513 单路径、总点数20001、NaN/Infinity、字符串坐标、非六位量化等值、巨型记录、SVG字符均拒绝；`0.1`与`1e-1`解析后等价，不测试词法差异 |
| 未知版本 | schema/geometry/renderer/parameter/DB 更高版本明确失败，原记录可检查/备份，不删库 |
| final6 零改动 | M15 每阶段前后文件数、总字节和逐文件 SHA-256 manifest 聚合一致；Git 状态没有该目录新增差异 |

### 12.1 final6 可复现冻结校验

不能依赖 `Get-ChildItem | Sort-Object` 的当前区域性排序，也不能只记录一个无法重建的聚合值。M15-1 开始前由总控在新增授权范围保存：

- `docs/qa/m15/final6-baseline.tsv`：规范 manifest；
- `docs/qa/m15/final6-baseline.sha256`：manifest 自身 SHA-256、文件数、总字节和生成规则版本；
- `scripts/delivery/verify-frozen-tree.ps1`：下述同一生成/比较逻辑。脚本和基线属于 M15 验收资产，不放入 final6。

规范 manifest 定义：根固定为 `delivery/v1-initial-20261023-final6`；相对路径分隔符统一 `/`；按 `.NET StringComparer.Ordinal` 对相对路径升序；每行精确为 `<relativePath>\t<decimalLength>\t<lowercaseFileSha256>\n`；UTF-8 无 BOM；包含末尾 LF。禁止包含绝对路径、mtime 或枚举序号。manifest 聚合 SHA-256 对上述完整字节（含末尾 LF）计算。

基线生成核心命令如下；`$outputPath` 必须指向上述 docs/qa 路径，绝不能位于冻结目录：

```powershell
$root = (Resolve-Path -LiteralPath 'delivery\v1-initial-20261023-final6').Path
$entries = [System.Collections.Generic.List[object]]::new()
Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object {
  $relative = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  $entries.Add([pscustomobject]@{
    RelativePath = $relative
    Length = $_.Length
    Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  })
}
$items = $entries.ToArray()
[Array]::Sort($items, [System.Collections.Generic.Comparer[object]]::Create(
  [System.Comparison[object]]{ param($a, $b) [StringComparer]::Ordinal.Compare($a.RelativePath, $b.RelativePath) }
))
$manifest = (($items | ForEach-Object { "$($_.RelativePath)`t$($_.Length)`t$($_.Sha256)" }) -join "`n") + "`n"
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($outputPath, $manifest, $utf8)
$aggregate = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($manifest))).ToLowerInvariant()
```

每次复核用同一逻辑生成到工作区外临时文件，先按字节与 baseline TSV 比较，再比较聚合、文件数和总字节；任一差异输出首个相对路径及 baseline/current 长度和文件哈希并失败，绝不“刷新基线”掩盖变化。更新基线只能由总控针对明确的新冻结版本授权，M15 不得更新 final6 基线。

按该规范对当前 final6 的只读计算是 836 个文件、330,367,241 字节，manifest SHA-256 为 `c3a28d75d0e1577329217f2f84a19030d10f0e8b21f046bac38c5fa0bee6ff31`。此前 M15-0 交接中的 `7510…` 使用了未完整规定的排序/无末尾 LF拼接，只保留为历史执行记录，不再作为规范基线。

## 13. 依赖决策

推荐不新增生产依赖。原因：RDP 很小；允许域为现有凸多边形；自由路径只需简单多边形自交检测而不做任意 polygon boolean；镂空 union 由 SVG luminance mask 的黑色叠加自然实现。

因此本轮没有要安装的包，也没有依赖批准请求。如果 M15-2 证明 512 点 O(n²) 自交校验达不到预算，只能提交新的候选评审，至少列出精确包名/版本、许可证、压缩与解压体积、最近维护、安全公告、确定性/浏览器兼容、tree-shaking 和不用它的实测代价；批准前不得安装。即使引库也不能引入第二套 renderer 或几何内核。

## 14. 未决问题与推荐结论

| 问题 | 推荐结论 | 批准要求 |
| --- | --- | --- |
| v2 版本如何隔离 | Work/operation/editor profile/editor geometry/editor renderer升2；嵌入的内容TemplateVersionV1保持原字段和版本1 | 总控批准 CR-M15-01 |
| 自由路径限额/容差 | 保存格式的512/20000、量化和几何阈值按M15-1/2冻结；raw 4096仅暂定 | M15-2算法基准、M15-5 Worker浏览器验证后，总控在M15-6首次持久化前最终批准raw上限 |
| v2 模板能力从哪里来 | 保留 v1 templateSnapshot，另存本地批准的 editorProfileSnapshot；注册表只追加，停用仅影响新建 | 总控逐项批准三个模板 profile 及 historicalMode |
| v1 是否直接编辑 | 否；v1 保持只读及导出，只有精确 profile 匹配才允许新 ID 另存 v2 | 总控批准产品文案与迁移入口 |
| IndexedDB 是否升物理版本 | 不升，继续 v3；只有 store/index 变化才另提 CR | M15-6 实现前复核 |
| 是否引入几何库 | 否，第一阶段没有 polygon boolean 需求 | 若性能证据否定，再单独审批候选 |
| 自由路径逐点编辑/开放刀路/实体连通 | M15 第一阶段均不做 | 未来新里程碑与新版本提案 |
| 参数切口移动是否用 update-cut | 是，参数和自由路径共用 replace 语义，避免 UI 直接修改 operations | 总控批准命令联合 |

批准上述提案不等于功能已实现或浏览器验收通过。M15-0 完成后必须停止，等待 M15-1 明确授权。
