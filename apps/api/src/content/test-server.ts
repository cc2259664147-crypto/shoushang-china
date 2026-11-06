// Isolated verification entry; never imported by app.ts/server.ts or production bundles.
import Fastify from 'fastify';
import { crafts, exhibits, stories, templates } from '@shoushang/fixtures';
import { ContentDatabase } from '../database';
import { developmentData } from '../database/development';
import { contentRoutes, PublicContentService } from './index';

if (process.argv[2] === '--m12-test-server' || process.argv[2] === '--m12-development-server' || process.argv[2] === '--m12-inspect') {
  const path = process.argv[3];
  if (!path) throw new Error('Isolated database path required');
  const database = new ContentDatabase({ path });
  if (process.argv[2] === '--m12-inspect') {
    try { console.log(JSON.stringify(new PublicContentService(database).snapshot())); }
    finally { database.close(); }
  } else {
    if (process.argv[2] === '--m12-development-server') database.initializeDevelopment(developmentData);
    else {
      for (const [kind, rows] of [['craft', crafts], ['template', templates], ['exhibit', exhibits], ['story', stories]] as const) {
        for (const row of rows) {
          const revision = database.createRevision(kind, row, null, 'test-server');
          database.submit(kind, row.id, revision, 'test-server');
          database.publish(kind, row.id, revision, null, 'test-server');
        }
      }
    }
    const app = Fastify({ logger: false });
    await app.register(contentRoutes, { database });
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      console.log(JSON.stringify({ address }));
    } catch (error) { await app.close(); database.close(); throw error; }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().finally(() => database.close()); });
    process.stdin.resume();
    process.stdin.once('end', () => { void app.close().finally(() => database.close()); });
  }
}
