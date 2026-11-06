import { ContentDatabase } from './index';

/** Original, fictional software data only. No interviews, cultural claims or licensed external media. */
export const developmentData = {
  crafts: [{ id: 'craft-papercut', name: '开发示意：剪纸', slug: 'papercut', description: '只用于开发接口与剪纸工坊验证，无正式文化内容。', status: 'active', supportsExperience: true }],
  templates: [{
    id: 'template-dev-paper', craftId: 'craft-papercut', version: 1, name: '开发示意方纸', difficulty: 'beginner', steps: ['选择颜色', '添加几何切口'], enabled: true,
    geometry: { basePaper: { kind: 'square' }, symmetry: { kind: 'reflection', axis: 'vertical' }, allowedRegion: [{ x: 0.05, y: 0.05 }, { x: 0.45, y: 0.05 }, { x: 0.45, y: 0.95 }, { x: 0.05, y: 0.95 }] },
    allowedCuts: [{ shape: 'circle', minWidth: 0.02, maxWidth: 0.2, minHeight: 0.02, maxHeight: 0.2 }], rules: { minEdgeGap: 0.01, maxOperations: 100 }, recommendedColors: ['#B82025'],
    license: { name: '项目开发示意', attribution: '本项目自制几何规则' }, digitalNotice: '开发用途，不代表传统流派或实体剪裁保证。', geometryVersion: 1, rendererVersion: 1,
  }],
  exhibits: [], stories: [],
};

/** Explicit CLI: pnpm exec tsx apps/api/src/database/development.ts --initialize-development <path> */
if (process.argv[2] === '--initialize-development') {
  const path = process.argv[3];
  if (!path) throw new Error('Explicit database path is required');
  const db = new ContentDatabase({ path });
  try { console.log({ developmentOnly: true, initialized: db.initializeDevelopment(developmentData) }); }
  finally { db.close(); }
}
