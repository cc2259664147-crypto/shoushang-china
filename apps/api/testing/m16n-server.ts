// Isolated acceptance server: production API with an ephemeral development content database.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { ContentDatabase } from '../src/database';
import { developmentData } from '../src/database/development';

const directory = mkdtempSync(join(tmpdir(), 'shoushang-m16n-'));
const path = join(directory, 'content.sqlite');
const database = new ContentDatabase({ path });
database.initializeDevelopment(developmentData); database.close();
const app = await createApp({ databasePath: path });
await app.listen({ host: '127.0.0.1', port: 31876 });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  void app.close().finally(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0); });
});
