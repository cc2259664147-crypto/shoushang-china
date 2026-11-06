# M14-3F 非公开录入准备

日期：2026-10-21。已完成资料结构化与只读验证，**未执行后台录入或发布**。本阶段不改变 `review/intake-plan.md` 的实际执行门槛。

## 拟定映射（不是已存在的数据库ID）

| 候选 | 拟定稳定ID |
| --- | --- |
| E-R01 | `exhibit-spring-ring` |
| E-R02 | `exhibit-pig-papercut` |
| E-R03 | `exhibit-dog-papercut` |
| E-R04 | `exhibit-rooster-dawn` |
| E-R05 | `exhibit-daolingzhi` |
| E-R06 | `exhibit-dunhuang-stupa` |
| E-R07 | `exhibit-double-happiness` |
| E-R08 | `exhibit-zamenhof-disc` |
| E-R09 | `exhibit-woman-butterfly` |
| E-R10 | `exhibit-mao-redguards` |
| E-R13 | `exhibit-beijing-five-part-arch` |
| E-R14 | `exhibit-beijing-three-part-arch` |
| S-C01 | `story-zhou-shuying` |
| S-C02 | `story-zhang-xiufang` |
| S-C03 | `story-chen-qiuri` |
| T-C01 | `template-papercut-mirror-pairs` |
| T-C02 | `template-papercut-linear-rhythm` |
| T-C03 | `template-papercut-fourfold` |

18项均通过公共 `IdSchema` 格式和本包内重复检查。实际数据库冲突状态统一为 `not-checked`：本轮没有读取或连接任何实际数据库。工艺ID保持 `pending-total-controller-confirmation`，mediaId只接受未来后台上传返回值，模板保持 `pending-controlled-template-intake`。故事 `exhibitIds=[]`，展品 `storyIds=[]`、`templateIds=[]`，没有把无证据关联或测试ID转正。

M14-3G纠正并实证：表中的稳定ID始终只是编辑建议值，现有后台新建展品和故事时由服务器生成UUID。客户端不得传入建议ID，也不得直接写数据库。隔离验证取得的服务器ID仅属于该隔离批次，详见[intake/m14-3g-draft-intake.md](intake/m14-3g-draft-intake.md)。

## 结构化准备文件

- [m14-3f-preparation.json](intake/m14-3f-preparation.json)：由当前 manifest、展品稿和故事稿确定生成，包含18项映射、12个展品文本准备对象、3个故事文本准备对象、15个媒体准备对象及发布门禁。
- `tests/m14/build-content-intake.ts`：只读解析输入并重建上述JSON，不访问数据库或网络。
- `tests/m14/content-intake-core.ts`：集合、映射、文本、来源、关联和门禁校验。
- `tests/m14/content-intake-check.ts`：比较生成结果、核对哈希、真实解码上传件并执行失败用例。

故事来源按正文实际引用完整带入：S-C01含SRC-01；S-C02含人物条目SRC-02和扬州剪纸项目条目SRC-04（正文1引用行57）；S-C03含人物条目SRC-03和漳浦剪纸项目条目SRC-05（正文2项目背景，行48—59）。

准备对象没有伪造 `mediaId`、正式 `craftId`、数据库修订、更新时间或发布记录，因而不是可直接提交的完整 Exhibit/Story。可验证文本字段分别使用 `ExhibitSchema.shape`、`StorySchema.shape` 和 `SourceSchema` 校验；待真实绑定后仍须对完整对象执行公共schema和后台提交校验。

## 输入指纹（SHA-256）

这是受托判断的文件版本快照，不是法律批准或入库证明。路径相对代码根；版本变化后须重新生成准备文件并复核。

| 文件 | SHA-256 |
| --- | --- |
| `docs/content/review/index.html` | `58c5bf42906e4a179a284e000f64b13e7ac57f3facfe2f18ae63be0d429df7cc` |
| `docs/content/assets/m14-3c/manifest.json` | `cdb59a2395a3363d3a5fa2a8e2b3e64e4f4d80f32718a0542919e0deb1f8b86e` |
| `docs/content/exhibits-drafts.md` | `2e9ef8ecf5d2f6a14998786e388ae4c5a9081d5e8510d5f1e9fb8f64f80c13f2` |
| `docs/content/stories-drafts.md` | `163f0e3b7804d04bc76e229fb35a9b395b63072cb23e7a654603c7732c37bea4` |
| `docs/content/ATTRIBUTION.md` | `bb01ea6c7d5ed4db4775b5090c14f9cd183dbb79b4651a571fd485a01f22e595` |
| `docs/content/media-rights.md` | `3d9f93c92d23485a7f09e5aab429d56943a03c588573a9a546a49ade3ce945df` |
| `docs/content/fact-sources.md` | `42cf2e70d6c343e8ef6db2c6e8645ff2882151bfc546f97522a20939e513a3f1` |
| `docs/content/template-teaching.md` | `0ed803242f40bfe9fa7b13ef0b5dc045e5413cb80b7d0b3208ca9cd9b8724fd8` |

## 门禁状态

- 网站非商用：用户已确认；只解决 E-R06 的网站使用前提之一，比赛组织方再分发仍待核。
- E-R09、E-R10：`publishGate=blocked`，底本权利依据未核，不得提交发布就绪判断。
- 三张故事封面：只能作为非公开编辑封面候选；正式作者、委托/雇佣关系和网站/比赛用途权利链待确认。
- 三套模板：测试参数与拟定稳定ID已记录；正式工艺ID、受控模板接入、真人教学和正式权利链均未完成。
- 角色：真实编辑、审核和发布责任人未指定；不得由AI冒名。
- 正式发布：`none`；G-CONTENT：`open`。

逐媒体署名与分发计划见[署名交付计划](intake/attribution-delivery-plan.md)。未来后台调用和失败回退仍以 `review/intake-plan.md` 为准。
