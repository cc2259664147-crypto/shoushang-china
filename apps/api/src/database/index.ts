import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CraftSchema, ExhibitSchema, StorySchema, TemplateVersionSchema, IdSchema } from '@shoushang/contracts';
import { AdminStore, assertNoMaintenance } from './admin';
import { adminMigration, reviewOrderMigration } from './admin-schema';
export { AdminError } from './admin-schema';
export type { Access, Identity, AdminKind, Role } from './admin-schema';

export type ContentKind = 'craft' | 'template' | 'exhibit' | 'story';
interface StoredPublicSnapshot { rows: Record<string, SQLOutputValue>[]; revokedMedia: string[] }
export const contentSchemas = { craft: CraftSchema, template: TemplateVersionSchema, exhibit: ExhibitSchema, story: StorySchema };
function canonicalTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalTimes);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, (key === 'updatedAt' || key === 'accessedAt') && typeof item === 'string' ? new Date(item).toISOString() : canonicalTimes(item)]));
  return value;
}
export interface Migration { version: number; sql: string }
export const migrations: readonly Migration[] = [{ version: 1, sql: `
CREATE TABLE entities (
 kind TEXT NOT NULL CHECK(kind IN ('craft','template','exhibit','story')), id TEXT NOT NULL,
 latest_revision INTEGER NOT NULL DEFAULT 0, public_revision INTEGER,
 PRIMARY KEY(kind,id), FOREIGN KEY(kind,id,public_revision) REFERENCES revisions(kind,entity_id,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE revisions (
 kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 payload TEXT NOT NULL CHECK(json_valid(payload)), state TEXT NOT NULL CHECK(state IN ('draft','pending','published','withdrawn')),
 actor_id TEXT NOT NULL, created_at TEXT NOT NULL, proof_ref TEXT,
 PRIMARY KEY(kind,entity_id,revision), FOREIGN KEY(kind,entity_id) REFERENCES entities(kind,id)
);
CREATE UNIQUE INDEX template_version ON revisions(entity_id,json_extract(payload,'$.version')) WHERE kind='template';
CREATE TRIGGER immutable_revision BEFORE UPDATE OF payload,kind,entity_id,revision,actor_id,created_at,proof_ref ON revisions
 BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER retain_revision BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'retain revision'); END;
CREATE TRIGGER valid_public_pointer BEFORE UPDATE OF public_revision ON entities WHEN NEW.public_revision IS NOT NULL
 BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM revisions WHERE kind=NEW.kind AND entity_id=NEW.id AND revision=NEW.public_revision AND state='published') THEN RAISE(ABORT,'invalid public revision') END; END;
CREATE TABLE revoked_media (id TEXT PRIMARY KEY, revoked_at TEXT NOT NULL);
CREATE TABLE content_events (sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER, action TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE initialization_runs (name TEXT PRIMARY KEY, created_at TEXT NOT NULL);
` }, adminMigration, reviewOrderMigration];

/** All pending migrations and their ledger entries commit together, including first creation. */
export function runMigrations(db: DatabaseSync, steps: readonly Migration[] = migrations): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => Number(r.version));
    if (applied.some((v, i) => v !== i + 1) || applied.length > steps.length || steps.some((s, i) => s.version !== i + 1)) throw new Error('Unsupported migration history');
    if (steps.length > applied.length && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_maintenance'").get()) assertNoMaintenance(db);
    for (const step of steps.slice(applied.length)) {
      db.exec(step.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(step.version, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Can back up an older schema BEFORE opening it with ContentDatabase (which migrates). */
export function backupBeforeMigration(source: string, destination: string): void {
  const target = resolve(destination);
  mkdirSync(dirname(target), { recursive: true });
  const db = new DatabaseSync(resolve(source), { readOnly: true });
  try { db.prepare('VACUUM INTO ?').run(target); }
  finally { db.close(); }
}

export class ContentDatabase {
  private readonly db: DatabaseSync;
  private readonly publicReadIdentity = randomUUID();
  readonly admin: AdminStore;
  private transactionDepth = 0;
  readonly path: string;
  constructor(options: { path: string }) {
    this.path = options.path === ':memory:' ? options.path : resolve(options.path);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
      runMigrations(this.db);
    } catch (error) { this.db.close(); throw error; }
    this.admin = new AdminStore(this.db);
  }
  close(): void { if (this.db.isOpen) this.db.close(); }
  private transaction<T>(fn: () => T, write = true): T {
    if (this.transactionDepth > 0) return fn();
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    this.transactionDepth++;
    try { if (write) assertNoMaintenance(this.db); const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.transactionDepth--; }
  }
  private event(kind: ContentKind | 'media', id: string, revision: number | null, action: string, actor: string): void {
    IdSchema.parse(actor);
    this.db.prepare('INSERT INTO content_events(kind,entity_id,revision,action,actor_id,created_at) VALUES (?,?,?,?,?,?)').run(kind, id, revision, action, actor, new Date().toISOString());
  }
  /** Trusted server boundary only. M13 must authorize the actor before calling. */
  createRevision(kind: ContentKind, input: unknown, expectedLatest: number | null, actor: string, proofRef: string | null = null): number {
    const parsed = contentSchemas[kind].parse(input);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT latest_revision FROM entities WHERE kind=? AND id=?').get(kind, parsed.id);
      if ((existing ? Number(existing.latest_revision) : null) !== expectedLatest) throw new Error('REVISION_CONFLICT');
      const revision = (expectedLatest ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new Error('REVISION_CONFLICT');
      const payload = contentSchemas[kind].parse(canonicalTimes('updatedAt' in parsed ? { ...parsed, revision, updatedAt: new Date().toISOString() } : parsed));
      if (!existing) this.db.prepare('INSERT INTO entities(kind,id) VALUES (?,?)').run(kind, parsed.id);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?)').run(kind, parsed.id, revision, JSON.stringify(payload), 'draft', actor, new Date().toISOString(), proofRef);
      this.db.prepare('UPDATE entities SET latest_revision=? WHERE kind=? AND id=?').run(revision, kind, parsed.id);
      this.event(kind, parsed.id, revision, 'create-draft', actor);
      return revision;
    });
  }
  submit(kind: ContentKind, id: string, revision: number, actor: string): void {
    this.transaction(() => {
      const result = this.db.prepare("UPDATE revisions SET state='pending' WHERE kind=? AND entity_id=? AND revision=? AND state='draft'").run(kind, id, revision);
      if (result.changes !== 1) throw new Error('REVISION_CONFLICT');
      this.event(kind, id, revision, 'submit', actor);
    });
  }
  publish(kind: ContentKind, id: string, revision: number, expectedPublic: number | null, actor: string): void {
    this.transaction(() => {
      const entity = this.db.prepare('SELECT public_revision FROM entities WHERE kind=? AND id=?').get(kind, id);
      if (!entity || entity.public_revision !== expectedPublic) throw new Error('REVISION_CONFLICT');
      const row = this.db.prepare("SELECT payload FROM revisions WHERE kind=? AND entity_id=? AND revision=? AND state='pending'").get(kind, id, revision);
      if (!row || typeof row.payload !== 'string') throw new Error('REVISION_CONFLICT');
      const payload = contentSchemas[kind].parse(JSON.parse(row.payload));
      if (kind === 'craft' && 'slug' in payload) {
        const duplicate = this.db.prepare("SELECT 1 FROM entities e JOIN revisions r ON r.kind=e.kind AND r.entity_id=e.id AND r.revision=e.public_revision WHERE e.kind='craft' AND e.id<>? AND json_extract(r.payload,'$.slug')=?").get(id, payload.slug);
        if (duplicate) throw new Error('Duplicate craft slug');
      }
      this.db.prepare("UPDATE revisions SET state='published' WHERE kind=? AND entity_id=? AND revision=?").run(kind, id, revision);
      this.db.prepare('UPDATE entities SET public_revision=? WHERE kind=? AND id=?').run(revision, kind, id);
      this.event(kind, id, revision, 'publish', actor);
    });
  }
  unpublish(kind: ContentKind, id: string, expectedPublic: number, actor: string): void {
    this.transaction(() => {
      const result = this.db.prepare('UPDATE entities SET public_revision=NULL WHERE kind=? AND id=? AND public_revision=?').run(kind, id, expectedPublic);
      if (result.changes !== 1) throw new Error('REVISION_CONFLICT');
      this.db.prepare("UPDATE revisions SET state='withdrawn' WHERE kind=? AND entity_id=? AND revision=?").run(kind, id, expectedPublic);
      this.event(kind, id, expectedPublic, 'unpublish', actor);
    });
  }
  revokeMedia(id: string, actor: string): void {
    IdSchema.parse(id);
    this.transaction(() => {
      this.db.prepare('INSERT INTO revoked_media VALUES (?,?) ON CONFLICT(id) DO NOTHING').run(id, new Date().toISOString());
      this.event('media', id, null, 'revoke-media', actor);
    });
  }
  /** One read snapshot for all associations, items and total; no raw records cross HTTP. */
  readPublicSnapshot(): StoredPublicSnapshot;
  readPublicSnapshot(knownVersion: string | undefined): { version: string; snapshot: StoredPublicSnapshot | null };
  readPublicSnapshot(...args: [] | [string | undefined]) {
    return this.transaction(() => {
      if (!args.length) return this.readPublicRows();
      // BEGIN alone is deferred. Pin data BEFORE observing its matching version.
      this.db.prepare('SELECT id FROM entities LIMIT 1').get();
      const external = this.db.prepare('PRAGMA data_version').get()!.data_version;
      const local = this.db.prepare('SELECT CAST(total_changes() AS TEXT) AS changes').get()!.changes;
      const version = `${this.publicReadIdentity}:${String(external)}:${String(local)}`;
      return { version, snapshot: version === args[0] ? null : this.readPublicRows() };
    }, false);
  }
  private readPublicRows(): StoredPublicSnapshot {
    return {
      rows: this.db.prepare("SELECT e.kind,r.payload FROM entities e JOIN revisions r ON r.kind=e.kind AND r.entity_id=e.id AND r.revision=e.public_revision WHERE r.state=?").all('published'),
      revokedMedia: this.db.prepare('SELECT id FROM revoked_media').all().map(r => String(r.id)),
    };
  }
  /** Internal read capability: version check and rows share one pinned WAL snapshot.
   * data_version detects commits by ANY other connection; total_changes also detects
   * this connection's M12/M13 writes (including triggers). Rollbacks may invalidate
   * unnecessarily but cannot retain a changed public view. Tokens are instance-local.
   */
  readPublicSnapshotSince(knownVersion?: string) {
    // Keep the existing controlled read/failure boundary for both cached and cold requests.
    return this.readPublicSnapshot(knownVersion);
  }
  /** VACUUM INTO includes committed WAL data in a consistent standalone snapshot. Target must not exist. */
  backup(destination: string): void {
    assertNoMaintenance(this.db);
    const target = resolve(destination);
    mkdirSync(dirname(target), { recursive: true });
    this.db.prepare('VACUUM INTO ?').run(target);
  }
  /** Explicit opt-in, atomic, once only. A pre-existing database is never seeded. */
  initializeDevelopment(dataset: { crafts: unknown[]; templates: unknown[]; exhibits: unknown[]; stories: unknown[] }): boolean {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM initialization_runs WHERE name=?').get('development-v1')) return false;
      if (this.db.prepare('SELECT 1 FROM entities LIMIT 1').get()) throw new Error('Development initialization requires an empty database');
      const groups = [['craft', dataset.crafts], ['template', dataset.templates], ['exhibit', dataset.exhibits], ['story', dataset.stories]] as const;
      for (const [kind, inputs] of groups) for (const input of inputs) {
        const dto = contentSchemas[kind].parse(input);
        // Preserve the workshop's canonical identity, with one tightly scoped craft exception.
        const developmentId = dto.id.includes('-dev-') || (kind === 'craft' && dto.id === 'craft-papercut' && 'slug' in dto && dto.slug === 'papercut');
        const developmentLabel = 'developmentOnly' in dto ? dto.developmentOnly
          : 'digitalNotice' in dto ? dto.name.includes('开发') && dto.digitalNotice.includes('开发')
          : 'name' in dto && 'description' in dto && dto.name.includes('开发') && dto.description.includes('开发');
        if (!developmentId || !developmentLabel) throw new Error('Development data must be explicitly labeled');
        const revision = this.createRevision(kind, dto, null, 'development-initializer');
        this.submit(kind, dto.id, revision, 'development-initializer');
        this.publish(kind, dto.id, revision, null, 'development-initializer');
      }
      this.db.prepare('INSERT INTO initialization_runs VALUES (?,?)').run('development-v1', new Date().toISOString());
      return true;
    });
  }

  /** Explicit versioned base-content initialization for a brand-new delivery database.
   * Exhibits, stories and media still enter through the authenticated admin HTTP workflow.
   */
  initializeBaseContent(name: string, dataset: { crafts: unknown[]; templates: unknown[] }): boolean {
    if (!/^v1-[a-z0-9-]+$/u.test(name)) throw new Error('A versioned V1 content-set name is required');
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM initialization_runs WHERE name=?').get(name)) return false;
      // Empty public content alone is insufficient: a maintained/withdrawn or account-only database is also occupied.
      const occupied = ['entities', 'admin_accounts', 'admin_media', 'content_events', 'revoked_media', 'initialization_runs', 'admin_audit', 'admin_reviews', 'admin_backup_jobs', 'admin_maintenance']
        .some(table => this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
      const customizedVocabulary = this.db.prepare("SELECT 1 FROM admin_vocabulary WHERE value<>'开发示意' LIMIT 1").get();
      if (occupied || customizedVocabulary) throw new Error('V1 base-content initialization requires an empty database');
      if (dataset.crafts.length !== 1 || dataset.templates.length !== 3) throw new Error('V1 base content must contain exactly one craft and three templates');
      const templateIds = dataset.templates.map(input => TemplateVersionSchema.parse(input).id);
      if (new Set(templateIds).size !== 3) throw new Error('V1 templates must have three independent identities');
      const groups = [['craft', dataset.crafts], ['template', dataset.templates]] as const;
      for (const [kind, inputs] of groups) for (const input of inputs) {
        const dto = contentSchemas[kind].parse(input);
        if (kind === 'craft' && dto.id !== 'craft-papercut') throw new Error('Unexpected V1 craft identity');
        if (kind === 'template' && (!dto.id.startsWith('template-v1-') || !('craftId' in dto) || dto.craftId !== 'craft-papercut')) throw new Error('Unexpected V1 template identity or craft mapping');
        const actor = `content-set-${name}`;
        const revision = this.createRevision(kind, dto, null, actor);
        this.submit(kind, dto.id, revision, actor);
        this.publish(kind, dto.id, revision, null, actor);
      }
      this.db.prepare('INSERT INTO initialization_runs VALUES (?,?)').run(name, new Date().toISOString());
      return true;
    });
  }
}
