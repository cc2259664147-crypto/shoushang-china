import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { HealthSchema, ReadinessSchema } from '@shoushang/contracts';
import { backupBeforeMigration, ContentDatabase } from './database';
import { contentRoutes } from './content';
import { adminRoutes, publicMediaRoutes } from './admin';
import type { AdminOptions } from './admin';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export type AdminIntegrationConfig = Omit<AdminOptions, 'database'>;
function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || path !== '..' && !path.startsWith('..\\') && !path.startsWith('../') && !isAbsolute(path);
}
function actualPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) return path;
  return join(actualPath(parent), path.slice(parent.length + (parent.endsWith('\\') || parent.endsWith('/') ? 0 : 1)));
}
function validatePrivateRoots(admin: AdminIntegrationConfig, databasePath: string): void {
  if (!isAbsolute(admin.mediaRoot) || !isAbsolute(admin.backupRoot)) throw new Error('Admin private roots must be absolute');
  const media = actualPath(resolve(admin.mediaRoot)), backup = actualPath(resolve(admin.backupRoot));
  const sourceTree = actualPath(resolve(projectRoot));
  const database = actualPath(databasePath);
  if (inside(sourceTree, database)) throw new Error('Enabled admin requires a private database outside the project tree');
  if (inside(sourceTree, media) || inside(sourceTree, backup) || inside(media, backup) || inside(backup, media)
    || inside(media, database) || inside(backup, database))
    throw new Error('Admin private roots must be separate, outside the project tree and away from the database');
}
function validatePublicMediaRoot(mediaRoot: string, databasePath: string): void {
  if (!isAbsolute(mediaRoot)) throw new Error('Public media root must be absolute');
  const media = actualPath(resolve(mediaRoot)), database = actualPath(databasePath);
  const sourceTree = actualPath(resolve(projectRoot));
  if (inside(sourceTree, media) || inside(sourceTree, database) || inside(media, database))
    throw new Error('Public media requires private roots outside the project tree and away from the database');
}
export function resolveAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminIntegrationConfig | null {
  const enabled = env.ADMIN_ENABLED;
  if (enabled !== undefined && enabled !== '0' && enabled !== '1') throw new Error('ADMIN_ENABLED must be 0 or 1');
  const fields = ['ADMIN_ORIGIN', 'ADMIN_SECURITY_MODE', 'ADMIN_MEDIA_ROOT', 'ADMIN_BACKUP_ROOT'] as const;
  if (enabled !== '1') {
    if (fields.filter(field => field !== 'ADMIN_MEDIA_ROOT').some(field => env[field] !== undefined)) throw new Error('ADMIN_ENABLED=1 is required when admin settings are provided');
    if (env.ADMIN_MEDIA_ROOT !== undefined && (!env.ADMIN_MEDIA_ROOT.trim() || !isAbsolute(env.ADMIN_MEDIA_ROOT))) throw new Error('Public media root must be absolute');
    return null;
  }
  if (fields.some(field => !env[field]?.trim())) throw new Error('Enabled admin requires origin, security mode, media and backup roots');
  const mediaRoot = env.ADMIN_MEDIA_ROOT!, backupRoot = env.ADMIN_BACKUP_ROOT!;
  if (!isAbsolute(mediaRoot) || !isAbsolute(backupRoot)) throw new Error('Admin private roots must be absolute');
  if (env.ADMIN_SECURITY_MODE !== 'loopback-http' && env.ADMIN_SECURITY_MODE !== 'https') throw new Error('Invalid ADMIN_SECURITY_MODE');
  return { origin: env.ADMIN_ORIGIN!, securityMode: env.ADMIN_SECURITY_MODE, listenHost: env.HOST ?? '127.0.0.1', mediaRoot: resolve(mediaRoot), backupRoot: resolve(backupRoot) };
}
export function resolveDatabasePath(configured = process.env.CONTENT_DATABASE_PATH ?? 'var/content.sqlite'): string {
  if (!configured.trim() || configured === ':memory:') throw new Error('An on-disk content database path is required');
  return resolve(projectRoot, configured);
}
/** The app exclusively owns its database; callers own app.close(). Never seeds content. */
export async function createApp(options: { databasePath?: string; onClose?: () => void; admin?: AdminIntegrationConfig | null; mediaRoot?: string } = {}) {
  const app = Fastify({ logger: false });
  try {
    const admin = options.admin === undefined ? resolveAdminConfig() : options.admin;
    if (admin && !isAbsolute(options.databasePath ?? process.env.CONTENT_DATABASE_PATH ?? 'var/content.sqlite'))
      throw new Error('Enabled admin requires an absolute private database path');
    const databasePath = resolveDatabasePath(options.databasePath);
    if (admin) validatePrivateRoots(admin, databasePath);
    const mediaRoot = options.mediaRoot ?? admin?.mediaRoot ?? process.env.ADMIN_MEDIA_ROOT;
    if (mediaRoot) validatePublicMediaRoot(mediaRoot, databasePath);
    // Existing data is backed up BEFORE the constructor can run pending migrations.
    if (existsSync(databasePath)) backupBeforeMigration(databasePath, `${databasePath}.backups/startup-${Date.now()}-${randomUUID()}.sqlite`);
    const database = new ContentDatabase({ path: databasePath });
    app.addHook('onClose', async () => { try { database.close(); } finally { options.onClose?.(); } });
    const identity = { service: '@shoushang/api', version: '0.1.0', contentMode: 'http' };
    app.get('/health', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return HealthSchema.parse({ status: 'ok', ...identity });
    });
    app.get('/ready', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      try {
        database.readPublicSnapshot();
        return ReadinessSchema.parse({ status: 'ready', database: 'ready', ...identity });
      } catch {
        return reply.code(503).send(ReadinessSchema.parse({ status: 'not-ready', database: 'unavailable', ...identity }));
      }
    });
    app.register(contentRoutes, { database });
    if (admin) app.register(adminRoutes, { ...admin, database });
    else if (mediaRoot) app.register(publicMediaRoutes, { database, mediaRoot });
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
