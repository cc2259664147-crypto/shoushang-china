// Reproducible transcription of the PRD. No status is inferred from test-file existence.
const fs = require('node:fs');
const prd = fs.readFileSync('../手上中国_产品需求文档_V1.0.md', 'utf8');
const rows = [];
const add = (id, original, method, evidence, result, issue = '—', env = 'W') => rows.push([id, original, method, env, evidence, result, issue]);
const test = 'evidence/m14-1/test-host.txt';
const normal = 'evidence/m14-1/acceptance-verified/report.json';
const publicApp = 'evidence/m14-1/public/browser-report.json';
const regression = name => `evidence/m14-1/regressions/${name}-report.json`;
const sectionMap = {
  4: ['FR-01', '首页/导航/空态/减少动态与音频：m11.spec.ts；正常首页→工坊：acceptance.spec.ts；人工M-A11Y及正式精选逐项复核', `${normal}；${regression('m11')}`],
  5: ['FR-02', 'workshop.spec.ts、core.test.ts、session.test.ts；正常键盘剪切/撤销重做/配色/自动保存/刷新：acceptance.spec.ts；每个正式模板人工D02—D05', `${normal}；${test}；${regression('m07-m08')}`],
  6: ['FR-02', '工坊离开保护/前进后退/冲突/坏记录/快照回归：workshop.spec.ts、storage.spec.ts；人工D02—D05和纯Tab顺序', `${regression('m07-m08')}；${regression('m05')}`],
  7: ['FR-03/04', '正常HTTP 25件交集/分页/收藏/刷新/历史：acceptance.spec.ts；故事关联：application.spec.ts；m10/m11专项；正式来源/许可与真机D07—D08', `${normal}；${publicApp}；${regression('m10')}；${regression('m11')}`],
  8: ['FR-05/06', '正常作品管理及PNG：acceptance.spec.ts；my-works.spec.ts、work-card-export.m08.spec.ts；系统相册D06及人工版式检查', `${normal}；evidence/m14-1/acceptance-catalog/png-check.json；${regression('m09')}；${regression('m07-m08')}`],
  9: ['FR-02/05/08', 'storage.spec.ts真实IndexedDB；http.test.ts真实HTTP；页面故障注入专项；人工D04/D09及目标设备存储失败', `${test}；${regression('m05')}；${regression('m07-m08')}；${regression('m10')}`],
  10: ['FR-07', 'normal-app.spec.ts登录/上传/审核/发布/下架/停用；admin.test.ts、database/admin.test.ts鉴权/校验/审计；正式事实与授权人工逐条核查', `evidence/m14-1/admin/report.json；${test}；../content/content-audit.md`],
  11: ['FR-01—08 数据约束', 'contracts/core/database/HTTP/存储自动测试；真实数据实体/关系/时间人工复核；不以schema存在作通过', `${test}；${regression('m05')}；../content/content-audit.md`],
  12: ['FR-08', 'content.test.ts、http.test.ts、admin.test.ts；普通Node构建/持久化/联合恢复；目标HTTPS与生产环境另验', `${test}；evidence/m14-1/built.json；evidence/m14-1/restore.json；release-checklist.md`],
};
for (const [id, name] of [['FR-01', '沉浸式首页'], ['FR-02', '剪纸工坊'], ['FR-03', '匠人故事'], ['FR-04', '数字展馆'], ['FR-05', '我的作品'], ['FR-06', '作品卡导出'], ['FR-07', '内容管理后台'], ['FR-08', '数据服务']]) {
  const match = prd.split('\n').find(l => l.startsWith(`| ${id} |`));
  add(id, match || name, '汇总项；下方逐段P0和AC分别审查，正式内容/真机/性能不能由工程测试替代', '本矩阵；test-report.md；content-audit见../content/', '待人工验证', 'G-CONTENT、G-DEVICE、G-USERS、G-PERF、G-PROD，FR-06另见F-PNG-PERF');
}
let extraSection = '', extraCount = 0;
for (const raw of prd.split('\n')) {
  const line = raw.trim(), heading = /^### (\d+\.\d+) /u.exec(line);
  if (heading) extraSection = heading[1];
  if (!['1.3', '2.2', '3.1', '3.3', '13.3'].includes(extraSection) || !line || line.startsWith('#') || line === '---PAGE---' || /^\|[ -]+\|/u.test(line)) continue;
  add(`P0-GLOBAL §${extraSection}-${++extraCount}`, line,
    '角色/版本边界：正常后台401/403与发布/隐私隔离；流程：正常创作/HTTP目录与专项回归；安全校验：全量自动测试；目标数字/生产安全仍需人工清单',
    `${normal}；evidence/m14-1/admin/report.json；${test}；manual-validation.md；release-checklist.md`,
    '待人工验证', '本行完整原要求需逐项满足；用户目标/正式内容/生产环境不以工程测试替代');
}
let section = '', chapter = 0, serial = {};
for (const raw of prd.split('\n')) {
  const line = raw.trim(); const heading = /^### (\d+\.\d+) /u.exec(line);
  if (heading) { section = heading[1]; chapter = Number(section.split('.')[0]); }
  if (!sectionMap[chapter] || !line || line.startsWith('#') || line === '---PAGE---' || line.startsWith('- AC-') || line.startsWith('| AC-') || /^\|[ -]+\|/u.test(line)) continue;
  // Include every prose requirement and every semantic table row in PRD chapters 4–12.
  const [fr, method, evidence] = sectionMap[chapter]; serial[section] = (serial[section] || 0) + 1;
  let result = '待人工验证', reason = '工程覆盖范围见test-report；本行完整原要求尚含正式内容/人工或未逐项采样条件，不能整体判通过';
  if ((section === '5.1' && line.includes('不少于3个')) || (section === '10.1' && line.includes('首发至少3个'))) { result = '失败'; reason = 'G-CONTENT：正式可确认0模板/0展品/0故事'; }
  add(`${fr} §${section}-${serial[section]}`, line, method, evidence, result, reason);
}
const ac = {
  1: ['本轮通过', normal, '正常首页开始入口→真实HTTP工坊并完成剪切', '—', 'W-R'],
  2: ['待人工验证', `${normal}；${publicApp}；${regression('m11')}`, '入口/关联已自动验证；正式精选逐条有效性待内容交付', 'G-CONTENT'],
  3: ['本轮通过', regression('m11'), 'reduced motion retains all entries and no audio plays…专项；显式mock内容，非真机', '—', 'W-F'],
  4: ['本轮通过', regression('m11'), '同上：首次/跨页音频与减少动态效果浏览器断言', '—', 'W-F'],
  5: ['待人工验证', normal, '开发模板完成保存通过；要求任一正式模板均成功需3模板复核', 'G-CONTENT'],
  6: ['本轮通过', regression('m07-m08'), 'invalid candidate…非法位置按钮禁用且历史切口不变', '—', 'W-F'],
  7: ['本轮通过', `${test}；${regression('m07-m08')}`, 'three shapes, palette, two undos and a new branch＋核心黄金样例', '—', 'W-F'],
  8: ['本轮通过', `${test}；${regression('m07-m08')}`, '撤销后新增操作分支清空、redo禁用', '—', 'W-F'],
  9: ['本轮通过', `${normal}；${regression('m07-m08')}`, '纸色变化切口保留，刷新恢复同色；三形状专项', '—', 'W-R/W-F'],
  10: ['本轮通过', normal, '无手动保存，自动保存成功后reload恢复名称/切口/纸色；步骤专项见回归', '—', 'W-R'],
  11: ['本轮通过', regression('m07-m08'), 'simulated transaction failure…真实事务边界注入容量失败，保留画布/重试/导出', '故障注入，不是真实设备耗尽', 'W-I'],
  12: ['本轮通过', `${regression('m07-m08')}；${regression('m05')}`, '两页共用新隔离IDB产生真实修订冲突，允许副本、不覆盖', '—', 'W-F'],
  13: ['待人工验证', regression('m07-m08'), '触屏模拟与视口旋转通过；真机D02/D03未执行', 'G-DEVICE'],
  14: ['待人工验证', normal, '键盘聚焦/Enter激活已通过；完整Tab导航、位置/尺寸替代流程见人工步骤2', 'G-A11Y'],
  15: ['本轮通过', `${normal}；${regression('m10')}`, '正常25件目录交集/分页/刷新/前进后退；mock专项精确滚动位置/焦点', '—', 'W-R/W-F'],
  16: ['本轮通过', `${normal}；${regression('m10')}`, '真实HTTP详情收藏/刷新/取消；个人收藏空态/多入口专项', '—', 'W-R/W-F'],
  17: ['本轮通过', `${test}；evidence/m14-1/admin/report.json`, '真实公开列表/详情过滤未发布状态；后台草稿不覆盖旧公开版', '—', 'W-R'],
  18: ['待人工验证', `${publicApp}；${regression('m11')}`, '精确关联模板/来源外链与离开保护专项通过；真实文化来源尚缺', 'G-CONTENT'],
  19: ['本轮通过', `${normal}；${regression('m09')}；${regression('m05')}`, '正常新增/复制/改名/删除reload；新独立持久profile重启验证（fixture）', '—', 'W-R/W-F'],
  20: ['待人工验证', `evidence/m14-1/acceptance-catalog/png-check.json；${regression('m07-m08')}`, '真实1600×2000 PNG、alpha/像素/镂空专项通过；正式模板/长字视觉需人工D06', 'G-CONTENT、G-A11Y'],
  21: ['本轮通过', regression('m07-m08'), 'double click…互斥；font/image/canvas/encoder注入后重试，保留旧图/作品', '仅故障专项', 'W-I'],
  22: ['待人工验证', `${regression('m09')}；${regression('m05')}`, '100件容量读/改/删专项通过；手机系统保存未执行D06', 'G-DEVICE'],
  23: ['本轮通过', `${test}；evidence/m14-1/admin/report.json`, '真实HTTP 401/403、伪造role/Origin/CSRF、停用与过期；UI权限', '本地HTTP模式；生产HTTPS另验', 'W-R'],
  24: ['本轮通过', 'evidence/m14-1/admin/report.json', '编辑草稿→审核发布→正常前台读取→新草稿旧版仍可读→下架', '隔离示意内容', 'W-R'],
  25: ['本轮通过', test, 'admin/database专项：缺来源/授权/字段/关系、非法真实媒体；错误字段回传', '不能替代事实和权属人工核实', 'W-R/W-I'],
  26: ['本轮通过', `${test}；evidence/m14-1/admin/report.json`, '发布/下架/停用及持久审计、幂等、修订历史与操作者专项', '—', 'W-R'],
};
for (let n = 1; n <= 26; n++) {
  const id = `AC-${String(n).padStart(2, '0')}`;
  const original = prd.split('\n').find(l => l.startsWith(`- ${id}：`) || l.startsWith(`| ${id} |`));
  if (!original) throw new Error('Missing original ' + id);
  const [result, evidence, method, issue, env] = ac[n]; add(id, original, method, evidence, result, issue, env || 'W');
}
const nfr = [
  ['NFR-01', '五次独立Chrome冷缓存、CDP固定网速/CPU；LCP/CLS原始样本及session-window算法', 'evidence/m14-1/performance/samples.json', '待人工验证', '当前Chrome开发空目录样本达标；Chrome129及正式内容缺失，G-PERF', 'C'],
  ['NFR-02', '至少100次输入到真实视觉更新；基准模板50次操作状态，逐次采样并算P95，5轮记录；需要呈现时刻证据', 'performance-report.md', '未执行', 'G-PERF：现有回归只计50/100两次自动化click到计数可见，不符合完整口径', '—'],
  ['NFR-03', '5轮默认PNG，输入事件前到生成、decode及完整Blob可读；中位数与5s比较', 'evidence/m14-1/performance/samples.json', '失败', 'F-PNG-PERF：中位10159.3ms；Chrome129仍缺', 'C'],
  ['NFR-04', '1000合成展品、20闭环并发、5分钟，完整HTTP响应及JSON校验；nearest-rank P95/全部失败计数', 'evidence/m14-1/query/summary.json；evidence/m14-1/query/samples.jsonl', '失败', 'F-QUERY-PERF：P95=9635.24ms，17/1601错误=1.0618%；目标部署性能仍待验证', 'Q'],
  ['NFR-05', '七路径×五档宽度DOM scrollWidth及PNG；工坊画布实测方纸；主要操作可滚动触达补人工D10', 'evidence/m14-1/acceptance-catalog/layout-*.json；layout-*.png', '待人工验证', '当前采样无横溢出，正式内容/详情/后台全部状态与遮挡尚需补验，G-A11Y', 'W-R'],
  ['NFR-06', 'iOS Safari和Android Chrome当前稳定版各一真机，执行D01—D12', 'manual-validation.md', '待人工验证', 'G-DEVICE：无真机实测，桌面模拟不计', '—'],
];
for (const [id, method, evidence, result, issue, env] of nfr) add(id, prd.split('\n').find(l => l.startsWith(`| ${id} |`)), method, evidence, result, issue, env);
for (const [id, original, method, evidence, result, issue] of [
  ['A11Y-01', '§13.2 正文对比度至少4.5:1，大号文字至少3:1', '实测可解析实色背景文字WCAG相对亮度；等待有限CSS过渡结束；渐变/透明/图像与状态人工取色', 'evidence/m14-1/contrast-settled/contrast.json；manual-validation.md', '待人工验证', 'G-A11Y：自动采样不能覆盖全部状态'],
  ['A11Y-02', '§13.2 主要触控目标至少44×44 CSS像素', 'getBoundingClientRect量取全部可见交互，定位色板和导航目标', 'evidence/m14-1/acceptance-catalog/layout-390.json', '失败', 'F-TARGET：主要纸色按钮36×36'],
  ['A11Y-03', '§13.2 可见键盘焦点', '键盘聚焦/激活专项＋纯Tab/高对比人工步骤2', normal, '待人工验证', 'G-A11Y'],
  ['A11Y-04', '§13.2 语义标签、图片替代文本', '采样页面零unnamedInputs/零missingAlt；正式媒体逐一及读屏复验', 'evidence/m14-1/acceptance-catalog/layout-*.json', '待人工验证', 'G-CONTENT、G-A11Y'],
  ['A11Y-05', '§13.2 状态播报', 'role=status/alert/aria-live结构；人工读屏核对真实变化', 'evidence/m14-1/acceptance-catalog/layout-*.json；manual-validation.md', '待人工验证', 'G-A11Y：DOM存在不代表已听取播报'],
  ['A11Y-06', '§13.2 画布操作必须有按钮或数值替代', '正常键盘Enter完成剪切＋位置/尺寸/角度Tab纯键盘人工全流程', normal, '待人工验证', 'G-A11Y'],
  ['A11Y-07', '§13.2 弹层可用Escape关闭且焦点不丢失', '正常作品删除Escape与focus断言；菜单/大图专项；后台全状态补验', `${normal}；${regression('m10')}；${regression('m11')}`, '待人工验证', 'G-A11Y：采样弹层通过，尚非全部弹层'],
  ['A11Y-08', '§13.2 颜色不能成为唯一状态线索', '错误文字/状态文案专项，强制颜色和读屏人工步骤4', 'manual-validation.md；test-report.md', '待人工验证', 'G-A11Y'],
  ['CNT-01', '§10.1 至少3模板、12展品、3故事，模板须人工验证', '仓库盘点与来源/许可/审核记录交叉核实；不读实际用户库', '../content/content-audit.md', '失败', 'G-CONTENT'],
  ['CNT-02', '§10.1 每件文化内容维护事实来源和媒体许可两套信息', '逐件核对标题/机构作者/URL/访问日期/引用位置；媒体作者/来源/许可/证明/范围/署名', '../content/content-audit.md', '待人工验证', 'G-CONTENT：只有示意声明与字体许可，正式台账未提供'],
  ['REL-01', '§14.3 全部P0通过、阻断/严重为0、无数据丢失/导出失败/鉴权绕过/草稿泄漏/白屏/无授权媒体', '矩阵逐条关闭；不能平均通过率放行', 'defects.md；release-checklist.md', '失败', 'F-PNG-PERF、F-QUERY-PERF、F-TARGET、G-CONTENT及待验证项'],
  ['REL-02', '§14.3 生产构建、全新环境、后台重启、恢复、手机版核心流程、提交包检查；演示与正式模式分别验收', '本轮新隔离环境构建/重启/恢复；目标HTTPS、手机版、候选包人工清单', 'evidence/m14-1/built.json；restore.json；release-checklist.md', '待人工验证', 'G-DEVICE、G-PROD、G-SUBMISSION'],
  ['USR-01', '§1.3/§14.4 至少5名未参与开发目标用户，首次完成≥80%，中位≤5分钟；记录四任务成功率/耗时/误操作/反馈并复测', 'manual-validation用户脚本和空白表；真实独立性/同意另核实', 'manual-validation.md', '待人工验证', 'G-USERS：N=0，不把AI计入'],
  ['DEL-01', '§15.3 源码/锁/环境/产物/部署、设计/数据/OpenAPI、许可、内容台账、初始化/账号/恢复、测试/演示/回退资料', '完整与匿名候选包逐文件哈希/元数据检查；此轮仅准备清单，不制作包', 'release-checklist.md', '未执行', 'G-SUBMISSION'],
  ['OFFICIAL-01', '§15.4/§16.4 PRD转述手册：双版本、壹组命名、邮箱、匿名规范、重复提交说明', '向负责人取得最新官方手册/PPT/公告，核实匿名命名、IE和截止冲突', 'release-checklist.md', '待人工验证', 'G-OFFICIAL：当前只有PRD转述，不作为已核实官方规则'],
  ['OPS-01', '§16.1 HTTPS/健康检查/版本资源/兼容回退；每日DB+媒体备份7天；RPO≤24h/RTO≤4h；日志90天', '目标部署执行证书/代理/ACL/备份轮换/恢复计时/回退与日志策略验收', 'release-checklist.md；evidence/m14-1/restore.json', '待人工验证', 'G-PROD：隔离单次恢复不能证明生产运维SLA'],
  ['HIST-01', '最新独立审核197/197；正常后台2/2/公开3/3；普通Node/CLI/解码/重启/联合恢复；并行曾5秒超时后原限时单进程通过', '核对用户最新确认、audit目录JSON和集成历史日志，旧handoff待执行是历史', 'evidence/m14-1/history-index.json；test-report.md', '历史证据已核对', 'F-STABILITY：保留原超时记录，不直接加限时'],
]) add(id, original, method, evidence, result, issue, ['OFFICIAL-01','DEL-01','USR-01','OPS-01'].includes(id) ? '—' : 'W');
const escape = value => String(value ?? '').replaceAll('|', ' / ').replaceAll('\r', '').replaceAll('\n', '<br>');
const intro = `# M14-1 需求验收矩阵\n\n日期：2026-10-19（Asia/Shanghai）。需求基线：上一级《手上中国_产品需求文档_V1.0.md》。本表逐段转录第4—12章P0原要求（含数据/接口表）、AC-01—26、NFR-01—06、§13.2、内容及交付；FR-09/P1、FR-10/P2不进入首发承诺。项目目标与赛事官方要求分列。\n\n结果只有：**本轮通过 / 历史证据已核对 / 失败 / 未执行 / 待人工验证**。本轮通过限于该行记录的实际环境和步骤；mock/故障注入不会证明正常真实链路，真实示意数据通过也不证明正式内容达标。原要求一段包含多个条件时，未全部证明就保持待验证，不能用代码存在或其他模块曾通过替代。\n\n环境：W=Windows 10.0.26300、Node24.19.0、pnpm11.25.0、Edge155.0.4283.62；W-R=正常App/HTTP/新SQLite和浏览器IndexedDB；W-F=显式mock内容/fixture专项（IDB、PNG仍为真实）；W-I=明确故障注入专项；C=已安装Chrome155.0.8059.80，1440×900、CDP 10/2Mbps、100ms、CPU4x、冷缓存、构建入口；Q=普通Node构建API、全新SQLite1000合成展品、回环20并发5分钟，服务端剖面条件见performance-report；—=未实际执行环境。所有库/账号/媒体/profile均独立，无实际用户数据。\n\n具体原始证据在相对本文件的evidence/m14-1/；测试名/人工步骤位于验证方法列及test-report/manual-validation。§5—12整段标待人工，并不否认其已测子项；AC行给出可确定的验证结论。\n\n| 编号/映射 | 原始要求（逐段或原表行） | 方法/测试或人工步骤 | 实际环境 | 证据位置 | 结果 | 缺陷或未验证原因 |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
fs.writeFileSync('docs/qa/acceptance-matrix.md', intro + rows.map(row => '| ' + row.map(escape).join(' | ') + ' |').join('\n') + '\n');
console.log(JSON.stringify({ rows: rows.length, ac: 26, nfr: 6, p0Transcribed: Object.values(serial).reduce((a,b)=>a+b,0) }));
