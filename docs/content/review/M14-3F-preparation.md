# M14-3F 非公开录入准备

日期：2026-10-21。已开始资料准备，未执行后台录入或发布。本阶段不改变 intake-plan.md 实际执行门槛。

## 拟定映射（不是已存在的数据库ID）

| 候选 | 拟定稳定ID |
| --- | --- |
| E-R01 | exhibit-spring-ring |
| E-R02 | exhibit-pig-papercut |
| E-R03 | exhibit-dog-papercut |
| E-R04 | exhibit-rooster-dawn |
| E-R05 | exhibit-daolingzhi |
| E-R06 | exhibit-dunhuang-stupa |
| E-R07 | exhibit-double-happiness |
| E-R08 | exhibit-zamenhof-disc |
| E-R09 | exhibit-woman-butterfly |
| E-R10 | exhibit-mao-redguards |
| E-R13 | exhibit-beijing-five-part-arch |
| E-R14 | exhibit-beijing-three-part-arch |
| S-C01 | story-zhou-shuying |
| S-C02 | story-zhang-xiufang |
| S-C03 | story-chen-qiuri |
| T-C01 | template-papercut-mirror-pairs |
| T-C02 | template-papercut-linear-rhythm |
| T-C03 | template-papercut-fourfold |

实际执行前需通过公共schema/冲突校验；工艺ID从总控确认记录读取，mediaId只接受后台返回，故事exhibitIds为空。不得把测试ID直接转正。

## 输入指纹（SHA-256）

这是受托判断的文件版本快照，不是法律批准或入库证明。路径相对代码根；版本变更需重新计算并复核。

| 文件 | SHA-256 |
| --- | --- |
| docs/content/review/index.html | 58c5bf42906e4a179a284e000f64b13e7ac57f3facfe2f18ae63be0d429df7cc |
| docs/content/assets/m14-3c/manifest.json | cdb59a2395a3363d3a5fa2a8e2b3e64e4f4d80f32718a0542919e0deb1f8b86e |
| docs/content/exhibits-drafts.md | 2e9ef8ecf5d2f6a14998786e388ae4c5a9081d5e8510d5f1e9fb8f64f80c13f2 |
| docs/content/stories-drafts.md | 163f0e3b7804d04bc76e229fb35a9b395b63072cb23e7a654603c7732c37bea4 |
| docs/content/ATTRIBUTION.md | bb01ea6c7d5ed4db4775b5090c14f9cd183dbb79b4651a571fd485a01f22e595 |
| docs/content/media-rights.md | 3d9f93c92d23485a7f09e5aab429d56943a03c588573a9a546a49ade3ce945df |
| docs/content/fact-sources.md | 42cf2e70d6c343e8ef6db2c6e8645ff2882151bfc546f97522a20939e513a3f1 |
| docs/content/template-teaching.md | 0ed803242f40bfe9fa7b13ef0b5dc045e5413cb80b7d0b3208ca9cd9b8724fd8 |

## 下一步执行提示词

```text
你负责《手上中国》M14-3F：非公开录入准备。
代码根 C:/Users/mmcn/Desktop/shoushang-china/shoushang-china。

先完整阅读AGENTS.md、docs/tasks/M14.md、上一级PRD、
docs/contracts/data-model.md、docs/contracts/module-api.md、
docs/content/review/decisions.md、intake-plan.md、M14-3F-preparation.md、
docs/handoffs/M13.md、M13-integration.md、M14-content-review.md，
以及manifest、展品稿、故事稿、署名和权利台账。先查git status。

网站非商用已由用户确认。decisions.md是AI受托意见，不是人工签名、
真人教学、第三方授权或正式发布批准。保留现有脏修改，不提交/推送/部署。
允许修改docs/content/**、tests/m14/**及本阶段新handoff；
业务代码、contracts、路由、配置、依赖和锁文件只读。
当前只准备资料及测试，不创建账号、不上传、不写数据库、
不批准媒体许可、不进行内容审核、隔离发布或正式发布。

交付与步骤：
1. 整理12展品、3故事的非公开结构化录入准备文件。
   用现有公共schema校验可验证字段。若完整草稿需要尚未生成的mediaId，
   将文本准备对象和待绑定引用清单分离，明确校验范围，不塞假ID绕校验，
   不创建第二套内容库。
2. 校验18项候选映射的ID格式/重复；实际库冲突没有证据就标未核验。
   工艺/模板接入未获总控确认时保留待绑定，不复制测试runner到生产。
3. 集合严格E-R01—10、13、14；E-R11/12保持归档。
   故事exhibitIds为空，不关联无证据人物作品。
4. 每媒体列原件/上传件hash、真实格式尺寸、来源、许可、署名、修改，
   重新只读解码/校验hash，mediaId待后台实际返回，不覆盖原图。
5. E-R09/10明确权利待核、禁止发布；E-R06区分网站非商用与比赛分发。
   模板/封面正式权利链不得从AI参与推定已取得。
6. 生成详情、缩略、参赛包的逐项署名清单，计划不冒充已经上线。
7. 增加有意义的集合、缺字段、错误hash、错误关联和权利待核不得就绪
   的测试；运行相关类型检查和测试，记录真实命令、结果与局限。
8. 交接列出齐备项/未满足门禁、未来受控后台调用顺序与失败回退。

实际录入仍需intake-plan.md规定的真实责任人及审核分离、
真人教学记录、用途/权利条件落实、工艺/模板受控接入和新隔离路径。
遇到门禁缺口继续完成不受影响的准备，不伪造结果。
完成后停止：正式发布0、G-CONTENT未关闭、M14未完成。
```

未解除门禁：真人体验、角色责任人、E-R09/10底本依据、模板/封面正式权利链、参赛分发范围及许可落地。非商用不能代替这些证据。
