# M03 公开组件 API

所有组件与类型从 `@shoushang/ui` 导入；禁止引用src内部路径。组件只依赖React，不依赖contracts或业务包。使用React19 ref属性与原生元素属性扩展。消费端根节点添加`ss-theme`，在组合根只加载一次：

```tsx
import '@shoushang/ui/styles.css';
import { Button, FormField, TextInput } from '@shoushang/ui';
// 外层：<div className="ss-theme">...</div>
<FormField label="作品名称" required description="请输入名称" error={error}>
  {field => <TextInput {...field} value={name} onChange={e => setName(e.target.value)} />}
</FormField>
<Button loading={pending} onClick={handleAction}>提交</Button>
```

`error`等可选属性在exactOptionalPropertyTypes下应按需展开，如`{...(error ? {error} : {})}`，而非显式传undefined。主题作用域与门户需要在同一token继承链；原生dialog不会因top layer丢失继承。token集中在styles.css，消费端可用主题类覆盖，勿在各组件散落视觉常量。

## 组件与属性

| 公开组件 / 类型 | 属性与约定 |
| --- | --- |
| Button / ButtonProps / Intent | 扩展原生button属性与ref；intent=primary(默认)/secondary/ghost/danger；type默认button；loading、loadingLabel；disabled与loading均阻止点击，同一任务内有同步重复触发锁。调用方负责设置loading，不自动推断Promise。原文案保留在可访问名称内，视觉加载图形绝对定位保持尺寸，polite说明等待。加载结束不主动抢焦点。 |
| IconButton / IconButtonProps / CloseIcon | 必需非空aria-label（调用方负责本地化且不能传空串）；children为装饰图形，包装aria-hidden；44px触控范围。CloseIcon是自制关闭SVG，可自行传其他自制SVG；不能嵌入可聚焦或交互子元素。 |
| FormField / FormFieldProps / FieldControlProps | label必需，id可选（默认useId），description/error/required/describedBy；children为render函数，接收id、required、aria-describedby与aria-invalid。一个FormField仅关联一个控件，调用方必须展开field。required同时显示文字标记并传给原生控件。error非空时显示“错误：”与aria-invalid；description和error的ID合并到aria-describedby，可用describedBy追加外部说明。错误默认不重复alert；提交结果可放StatusMessage。 |
| TextInput / TextInputProps | 原生input属性及ref；默认type=text，建议本组件用于文字；支持value/onChange、disabled/readOnly/required等。受控值使用字符串，不混用defaultValue。 |
| TextArea / TextAreaProps | 原生textarea属性及ref；value/onChange由调用方控制，可设置rows。 |
| NumberInput / NumberInputProps / NumberValue | value:string，onValueChange({raw,number,badInput})必需；number为有限原生数值或null（空/中间输入），绝不将空值转0。raw为浏览器清洗后的input.value，不保证包含孤立负号/未完成指数；badInput区分空白与原生无效中间态。使用onInput读取每次原生编辑，避免React onChange漏掉value仍为空的负号；浏览器仍可暂存“-”“1e”等可编辑文本。不得把number再格式化回value。min/max/step/required直接传递，不截断或自动纠正。提交时读取原生validity/checkValidity或根据number+badInput校验业务约束。程序赋值或不同浏览器可清洗非法raw；不承诺任意非法字符串或跨浏览器相同中间文本。 |
| Select / SelectProps / SelectOption | 扩展原生select属性与ref，单选；options:[{value,label,disabled?}]，value唯一。配合FormField传label/description/error；不支持children/multiple、自定义搜索。 |
| InlineNotice / InlineNoticeProps / NoticeTone | tone=info/success/warning/error，children与可选action。静态内容不自动建立live region，避免页面初载大量播报。 |
| StatusMessage / StatusMessageProps | message:string，tone同上；默认role=status、polite，urgent=true才role=alert。稳定挂载且只更新有意义的message；同文案的普通重渲染不改动文本。若需要再次播报相同事件，调用方提供有意义的新消息（如尝试次数）。tone仅改变文字前缀与颜色，错误默认也为polite。 |
| LoadingState | label默认“正在加载，请稍候”；role=status，有文字与装饰spinner，减少动效时静止。仅在真实等待时挂载，勿在父层重复添加live region。 |
| EmptyState | title/description必需，action?:ReactNode；无数据读取/导航，行动由调用方传Button或原生链接。 |

## 弹窗

DialogProps：open（受控）、title（必需非空）、children、onClose(reason)、actions?、busy?、initialFocusRef?、returnFocusRef?、fallbackFocusRef?。onClose为关闭请求，调用方同步将open设为false；不要保留第二套内部打开状态。reason=escape/close-button/native（如内容里的form method=dialog）。外部将open=false也能关闭，不另回调关闭请求。点击背景不关闭。

showModal提供top layer与背景不可操作，组件补充Tab/Shift+Tab首尾循环。默认初始聚焦关闭按钮，可显式指定弹窗内元素。busy时聚焦弹窗本身，禁止关闭按钮、Escape和原生表单提交；调用方对actions按钮和正文交互的禁用负责。关闭后优先returnFocusRef或打开时的活动元素，元素移除/隐藏/禁用则转fallbackFocusRef，最后转文档首个.ss-theme。多主题页面应显式提供fallback。主题容器/后备标题可添加tabIndex=-1，不加入Tab序列。标题与操作区固定，正文独立滚动。

ConfirmDialogProps扩展Dialog但自行管理busy/actions/initialFocusRef：onConfirm():void|Promise<void>、confirmLabel必需；cancelLabel默认“取消”、danger默认false；errorMessage默认通用重试提示；onConfirmError?(unknown)、onPendingChange?(boolean)。onClose额外支持cancel/confirmed，调用方仍须设置open=false。

```tsx
<ConfirmDialog open={open} title="确认操作" danger
  confirmLabel="确认移除" cancelLabel="保留并取消"
  onConfirm={async () => { await removeThroughCaller(); }}
  onClose={() => setOpen(false)}>
  <p>说明本次操作的具体影响。</p>
</ConfirmDialog>
```

确认默认聚焦取消（危险操作同样如此），同步ref锁防止异步重复执行；onConfirm正常完成发confirmed请求，抛出异常则保留弹窗与子内容，显示可重试的polite错误。调用方把Result失败转换为抛出异常或适配后的Promise拒绝，不把已处理失败当成功resolve。等待期间不能取消、Escape或关闭，onPendingChange通知调用方；没有AbortSignal或请求取消能力。调用方须提供合理超时并保证Promise最终结算，不在等待时强制关闭/重开；外部强制关闭时，旧请求结果不会关闭新会话，但不会中断副作用。关闭再打开清空上次错误，内容状态由消费端决定。回调不得抛出额外未处理异常。

## 支持范围与限制

仅支持具备HTMLDialogElement.showModal的现代浏览器；不提供IE/polyfill。**不支持嵌套或同时多个弹窗**，打开时明确抛错，需消费端串行编排。无复杂焦点区域、Shadow DOM或自定义可编辑控件支持保证；Tab收集针对常规原生表单、按钮与链接。没有焦点动画、工具提示、菜单或复杂下拉。

本阶段真实Edge自动验证，未测屏幕阅读器、移动真机、Safari/Android。自动检查只能证明覆盖到的键盘/语义/布局行为，不代表全部辅助技术体验已验收。业务校验、存储、导航、内容接口与错误文案由后续页面负责。
