/** M14-3B isolated development candidates. Never imported by app startup. */
import { TemplateVersionSchema, type TemplateVersion } from '@shoushang/contracts';

const point = (x: number, y: number) => ({ x, y });
const rectangle = (left: number, top: number, right: number, bottom: number) => [point(left, top), point(right, top), point(right, bottom), point(left, bottom)];
const limit = (shape: 'circle' | 'triangle' | 'teardrop', min: number, max: number) => ({ shape, minWidth: min, maxWidth: max, minHeight: min, maxHeight: max });
const common = {
  craftId: 'craft-papercut', version: 1, enabled: true,
  geometryVersion: 1, rendererVersion: 1,
  license: { name: '隔离开发候选，正式权属待确认', attribution: '仅供M14-3B技术验证；不表示正式授权' },
  digitalNotice: '开发候选数字几何练习；不复刻传统作品，不保证实体可剪裁。',
} as const;

export const candidateTemplates: TemplateVersion[] = [
  TemplateVersionSchema.parse({ ...common, id: 'template-dev-c01', name: '开发候选 T-C01 · 方纸镜像：成对留白', difficulty: 'beginner',
    steps: ['选纸色并观察左半区', '用圆形或水滴形成成对留白', '展开、调整并保存'],
    geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'reflection', axis: 'vertical' }, allowedRegion: rectangle(.06, .08, .44, .92) },
    allowedCuts: [limit('circle', .025, .16), limit('teardrop', .03, .15)], rules: { minEdgeGap: .015, maxOperations: 30 },
    recommendedColors: ['#B82025', '#E59C38', '#276B62'],
  }),
  TemplateVersionSchema.parse({ ...common, id: 'template-dev-c02', name: '开发候选 T-C02 · 方纸线形节奏', difficulty: 'beginner',
    steps: ['选纸色并观察左半区', '用三角与水滴排列疏密节奏', '旋转、展开并保存'],
    geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'reflection', axis: 'vertical' }, allowedRegion: rectangle(.07, .07, .43, .93) },
    allowedCuts: [limit('triangle', .025, .12), limit('teardrop', .025, .12)], rules: { minEdgeGap: .012, maxOperations: 50 },
    recommendedColors: ['#B82025', '#445566', '#276B62'],
  }),
  TemplateVersionSchema.parse({ ...common, id: 'template-dev-c03', name: '开发候选 T-C03 · 四向重复：中心与边缘', difficulty: 'advanced',
    steps: ['选纸色并观察右下基础域', '布置圆、三角或水滴切口', '展开比较四向重复并保存'],
    geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'radial', sectors: 4, mirror: false }, allowedRegion: rectangle(.53, .53, .93, .93) },
    allowedCuts: [limit('circle', .025, .14), limit('triangle', .03, .14), limit('teardrop', .03, .14)], rules: { minEdgeGap: .015, maxOperations: 80 },
    recommendedColors: ['#B82025', '#276B62', '#F2D9A6'],
  }),
];

export const candidateById = Object.fromEntries(candidateTemplates.map(template => [template.id, template])) as Record<string, TemplateVersion>;
