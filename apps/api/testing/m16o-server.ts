import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exhibits, stories } from '@shoushang/fixtures';
import { ExhibitSchema, StorySchema } from '@shoushang/contracts';
import { createApp } from '../src/app';
import { ContentDatabase } from '../src/database';
import { developmentData } from '../src/database/development';

// Explicitly labelled development fixtures in an isolated real API database.
const directory = mkdtempSync(join(tmpdir(), 'shoushang-m16o-'));
const path = join(directory, 'content.sqlite');
const database = new ContentDatabase({ path });
database.initializeDevelopment(developmentData);
const exhibit = ExhibitSchema.parse({ ...exhibits[0], title: '开发联调：自制几何纸样', templateIds: ['template-dev-paper', 'template-v2-c04'] });
const story = StorySchema.parse({ ...stories[0], title: '开发联调：软件体验说明', templateId: 'template-dev-paper' });
for (const [kind, row] of [['exhibit', exhibit], ['story', story]] as const) {
  const revision = database.createRevision(kind, row, null, 'integration-test');
  database.submit(kind, row.id, revision, 'integration-test'); database.publish(kind, row.id, revision, null, 'integration-test');
}
database.close();
const app = await createApp({ databasePath: path });
await app.listen({ host: '127.0.0.1', port: 31877 });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  void app.close().finally(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0); });
});
