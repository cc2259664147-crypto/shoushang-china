// Explicit integration-test preparation only; never imported by app/server/build.
import { ContentDatabase } from '../src/database';
import { developmentData } from '../src/database/development';
import { exhibits, stories } from '@shoushang/fixtures';
import { ExhibitSchema, StorySchema } from '@shoushang/contracts';
const path = process.argv[3];
if (!path || !['--initialize', '--content', '--withdraw'].includes(process.argv[2] ?? '')) throw new Error('Explicit isolated test action and database path required');
const db = new ContentDatabase({ path });
try {
  if (process.argv[2] === '--initialize') db.initializeDevelopment(developmentData);
  if (process.argv[2] === '--content') {
    const exhibit = ExhibitSchema.parse({ ...exhibits[0], title: '开发联调：自制几何纸样', templateIds: ['template-dev-paper'] });
    const story = StorySchema.parse({ ...stories[0], title: '开发联调：软件体验说明', templateId: 'template-dev-paper' });
    for (const [kind, row] of [['exhibit', exhibit], ['story', story]] as const) {
      const revision = db.createRevision(kind, row, null, 'integration-test'); db.submit(kind, row.id, revision, 'integration-test'); db.publish(kind, row.id, revision, null, 'integration-test');
    }
  }
  if (process.argv[2] === '--withdraw') {
    db.unpublish('exhibit', 'exhibit-dev-paper', 1, 'integration-test');
    db.unpublish('story', 'story-dev-process', 1, 'integration-test');
  }
} finally { db.close(); }
