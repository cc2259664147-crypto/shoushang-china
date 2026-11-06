# M14-3F 非公开录入准备验证记录

日期：2026-10-21（Asia/Shanghai）。验证对象是结构化准备文件和本地素材，不是后台草稿、人工审核、许可批准或发布记录。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm exec tsc --noEmit -p tests/m14/tsconfig.json` | exit 0 |
| `pnpm exec tsx tests/m14/build-content-intake.ts` | exit 0；生成 `docs/content/intake/m14-3f-preparation.json` |
| `pnpm exec tsx tests/m14/content-intake-check.ts` | exit 0；18项映射、12展品、3故事、15媒体通过；19类反例正确拦截，覆盖映射/展品/故事/媒体集合缺项或错项、故事来源缺失、内容与媒体错绑、空字段、错误关联、错误hash，以及真人教学、E-R09权利/分发和发布状态伪造；15项上传件均完成真实完整解码、格式/尺寸和5 MiB检查 |
| `pnpm exec tsx tests/m14/content-preflight.ts docs/qa/evidence/m14-3c-teaching-29a4bcaada7949db9a40f3a301e90cd3 --strict-readiness` | exit 0；既有12件技术/资料齐备检查仍为12/12；输出同时明确人工编辑待审、正式发布none |

## 校验范围

公共schema用于校验当前可以确定的稳定ID、标题、分类、标签、摘要、正文、来源、日期/地区/作者、故事段落和空关联。完整 Exhibit/Story 仍缺后台返回的mediaId、总控确认的craftId、受控模板版本、数据库修订和时间，因此本轮不构造假值绕过完整schema；未来实际绑定后必须重新运行完整公共schema与后台提交校验。

故事来源精确集合同时核对：S-C01为SRC-01；S-C02为SRC-02和SRC-04；S-C03为SRC-03和SRC-05。媒体精确集合为12件展品主图和3张故事封面；每个内容对象只能绑定同候选号的待上传媒体。

媒体检查覆盖12件展品上传候选和3张故事PNG封面：本地路径、原件/上传件SHA-256、允许格式、记录尺寸、≤5 MiB及完整像素解码。测试没有写入媒体目录或数据库。

## 保留的失败门禁

- E-R09/E-R10为权利待核草稿，`publishGate=blocked`；
- E-R06只记录网站非商用已确认，比赛分发仍待核；
- 三张故事封面正式权利链待确认；
- 三套模板正式接入、真人教学和权利链待确认；
- 数据库ID冲突未核验，真实角色责任人未指定；
- 正式发布为none，G-CONTENT保持open。
