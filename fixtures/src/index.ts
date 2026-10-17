import { CraftSchema, ExhibitSchema, StorySchema, TemplateVersionSchema, WorkSchema } from '@shoushang/contracts';

export const fixtureTime = '2026-10-17T00:00:00Z';
const license = { name: 'CC0-1.0', attribution: '项目自制开发几何示意' };
const source = { title: 'M01 开发占位说明', author: '项目开发样例', accessedAt: fixtureTime, citation: '仅说明软件测试用途', note: '不构成文化事实、采访或身份依据' };
const media = { id: 'media-dev-paper', url: '/dev-paper.svg', alt: '开发占位：方形与圆形组成的自制几何示意', author: '项目开发样例', license, width: 400, height: 400, kind: 'illustration' as const };
export const crafts = [CraftSchema.parse({ id: 'craft-papercut', name: '剪纸', slug: 'papercut', description: '数字剪纸体验；模板当前仅作开发验证', status: 'active', supportsExperience: true })];
export const templates = [TemplateVersionSchema.parse({
  id: 'template-dev-square', craftId: 'craft-papercut', version: 1, name: '开发占位方纸', difficulty: 'beginner',
  steps: ['开发占位，尚非可用工坊模板'], enabled: true,
  geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'reflection', axis: 'vertical' }, allowedRegion: [{ x: 0.05, y: 0.05 }, { x: 0.45, y: 0.05 }, { x: 0.45, y: 0.95 }, { x: 0.05, y: 0.95 }] },
  allowedCuts: ['circle', 'triangle', 'teardrop'].map(shape => ({ shape, minWidth: 0.02, maxWidth: 0.2, minHeight: 0.02, maxHeight: 0.2 })),
  rules: { minEdgeGap: 0.01, maxOperations: 100 }, recommendedColors: ['#B82025', '#FFFFEE', '#112233', '#445566', '#778899', '#BB7744'], license,
  digitalNotice: '开发占位数字示意，不代表传统流派，不保证可实体剪裁。', geometryVersion: 1, rendererVersion: 1,
})];
export const exhibits = [ExhibitSchema.parse({
  id: 'exhibit-dev-paper', title: '开发占位：几何纸样', craftId: 'craft-papercut', category: '开发示意', tags: ['占位', '几何'],
  summary: '用于校验内容接口的自制示意，不是正式文化展品。', description: '本条仅验证工程链路。不得作为真实文物、流派或传承人作品发布。',
  media: [media], sources: [source], storyIds: ['story-dev-process'], templateIds: ['template-dev-square'],
  dateLabel: '未注明', region: '开发占位', creator: '项目自制示意', meaning: '无文化事实断言', sortOrder: 0,
  revision: 1, updatedAt: fixtureTime, developmentOnly: true,
})];
export const stories = [StorySchema.parse({
  id: 'story-dev-process', title: '开发占位：数字体验说明', personName: '未配置真实人物', personBio: '无传承人身份、采访或荣誉信息。',
  craftIds: ['craft-papercut'], region: '开发占位', summary: '这是一条开发占位故事。', cover: media,
  body: [{ type: 'paragraph', text: '仅用于页面与接口开发。正式故事须另行取得事实来源、人物核实和素材授权。' }],
  timeline: [], sources: [source], exhibitIds: ['exhibit-dev-paper'], templateId: 'template-dev-square', sortOrder: 0,
  revision: 1, updatedAt: fixtureTime, developmentOnly: true,
})];
export function createFixtureWork() {
  return WorkSchema.parse({ id: 'work-dev-example', name: '开发测试作品', craftId: 'craft-papercut', templateSnapshot: templates[0],
    palette: { paper: '#B82025', background: '#FFFFEE' }, operations: [], status: 'draft', schemaVersion: 1, revision: 0, createdAt: fixtureTime, updatedAt: fixtureTime });
}
