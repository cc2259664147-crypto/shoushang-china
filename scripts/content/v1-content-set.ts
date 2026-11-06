import { CraftSchema, TemplateVersionSchema } from '@shoushang/contracts';

const point = (x: number, y: number) => ({ x, y });
const rectangle = (left: number, top: number, right: number, bottom: number) => [point(left, top), point(right, top), point(right, bottom), point(left, bottom)];
const limit = (shape: 'circle' | 'triangle' | 'teardrop', min: number, max: number) => ({ shape, minWidth: min, maxWidth: max, minHeight: min, maxHeight: max });
const common = {
  craftId: 'craft-papercut', version: 1, enabled: true, geometryVersion: 1, rendererVersion: 1,
  license: { name: '项目生成数字练习', attribution: '《手上中国》项目设计，AI辅助整理；未使用第三方模板素材' },
  digitalNotice: '项目生成的数字几何练习，不复刻地方传统工序，不保证可直接进行实体剪裁。',
} as const;

export const V1_CONTENT_SET_NAME = 'v1-initial-2026-10-22';
export const v1Craft = CraftSchema.parse({
  id: 'craft-papercut', name: '剪纸数字工坊', slug: 'papercut',
  description: '以对称、留白和重复关系为学习目标的数字剪纸体验。', status: 'active', supportsExperience: true,
});
export const v1Templates = [
  TemplateVersionSchema.parse({ ...common, id: 'template-v1-c01', name: '方纸镜影：成对留白', difficulty: 'beginner',
    steps: ['选择纸色并观察左半区', '用圆形或水滴形成成对留白', '展开、调整并保存'],
    geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'reflection', axis: 'vertical' }, allowedRegion: rectangle(.06, .08, .44, .92) },
    allowedCuts: [limit('circle', .025, .16), limit('teardrop', .03, .15)], rules: { minEdgeGap: .015, maxOperations: 30 }, recommendedColors: ['#B82025', '#E59C38', '#276B62'],
  }),
  TemplateVersionSchema.parse({ ...common, id: 'template-v1-c02', name: '方纸节奏：疏密与方向', difficulty: 'beginner',
    steps: ['选择纸色并观察左半区', '用三角与水滴排列疏密节奏', '旋转、展开并保存'],
    geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'reflection', axis: 'vertical' }, allowedRegion: rectangle(.07, .07, .43, .93) },
    allowedCuts: [limit('triangle', .025, .12), limit('teardrop', .025, .12)], rules: { minEdgeGap: .012, maxOperations: 50 }, recommendedColors: ['#B82025', '#445566', '#276B62'],
  }),
  TemplateVersionSchema.parse({ ...common, id: 'template-v1-c03', name: '四向回旋：中心与边缘', difficulty: 'advanced',
    steps: ['选择纸色并观察右下基础域', '布置圆、三角或水滴切口', '展开比较四向重复并保存'],
    geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'radial', sectors: 4, mirror: false }, allowedRegion: rectangle(.53, .53, .93, .93) },
    allowedCuts: [limit('circle', .025, .14), limit('triangle', .03, .14), limit('teardrop', .03, .14)], rules: { minEdgeGap: .015, maxOperations: 80 }, recommendedColors: ['#B82025', '#276B62', '#F2D9A6'],
  }),
];

export const storyTemplateIds: Record<string, string> = {
  'S-C01': 'template-v1-c01', 'S-C02': 'template-v1-c02', 'S-C03': 'template-v1-c03',
};
