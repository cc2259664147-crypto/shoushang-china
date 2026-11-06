import Fastify from 'fastify';
import { existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ContentDatabase } from '../../database';
import { developmentData } from '../../database/development';
import { contentRoutes } from '../../content';
import { adminRoutes, assertAdminListener } from '../index';
import { hashPassword } from '../security';
const root = process.env.M13_TEST_ROOT, password = process.env.M13_TEST_PASSWORD;
if (process.argv[2] !== '--isolated-admin-server' || !root || !isAbsolute(root) || !password || password.length < 24)
    throw new Error('Explicit isolated test configuration required');
const path = join(root, 'content.sqlite');
const restart = process.env.M13_TEST_RESTART === '1';
if (existsSync(path) !== restart || restart && !existsSync(join(root, 'm13-test.marker')))
    throw new Error('Test database must be NEW or explicitly marked for isolated restart');
const db = new ContentDatabase({ path });
if (!restart) {
    writeFileSync(join(root, 'm13-test.marker'), 'isolated-test', { flag: 'wx' });
    db.initializeDevelopment(developmentData);
    const hash = await hashPassword(password);
    db.admin.maintenanceAccount('browser-admin', 'admin', hash);
    db.admin.maintenanceAccount('browser-editor', 'editor', hash);
}
const app = Fastify();
const config = { database: db, origin: process.env.M13_TEST_ORIGIN ?? 'http://127.0.0.1:5193', securityMode: 'loopback-http' as const, listenHost: '127.0.0.1', mediaRoot: join(root, 'media'), backupRoot: join(root, 'backups') };
app.addHook('onClose', async () => db.close());
await app.register(contentRoutes, { database: db });
await app.register(adminRoutes, config);
app.get('/test-ready', async () => ({ ready: true }));
await app.listen({ host: '127.0.0.1', port: Number(process.env.M13_TEST_PORT ?? 31393) });
assertAdminListener(app, config);
process.stdout.write(JSON.stringify({ ready: true, address: app.server.address() }) + '\n');
let closing = false;
const close = () => { if (closing)
    return; closing = true; void app.close().finally(() => process.exit(0)); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
if (process.env.M13_CLOSE_ON_STDIN === '1') {
    process.stdin.resume();
    process.stdin.once('end', close);
}
