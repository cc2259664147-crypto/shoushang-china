import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdir, open, rename, rm, lstat, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AdminError } from '../database';
import type { Access, ContentDatabase } from '../database';
import { digest, idOf } from '../database/admin-schema';
export interface Decoded {
    format: string;
    width: number;
    height: number;
    original: Buffer;
    thumbnail: Buffer;
}
let active = 0;
export async function decodeImage(bytes: Buffer, options: {
    timeoutMs?: number;
    workerPath?: string;
} = {}): Promise<Decoded> {
    if (!bytes.length || bytes.length > 5 * 1024 * 1024)
        throw new AdminError('PAYLOAD_TOO_LARGE', '单文件不得超过5MB');
    if (active >= 2)
        throw new AdminError('RATE_LIMITED', '图片处理繁忙，请稍后重试');
    active++;
    let closed = Promise.resolve();
    try {
        return await new Promise<Decoded>((yes, no) => {
            const local = dirname(fileURLToPath(import.meta.url));
            const worker = options.workerPath ?? join(local, existsSync(join(local, 'decoder-worker.js')) ? 'decoder-worker.js' : 'decoder-worker.ts');
            const child = spawn(process.execPath, [...(worker.endsWith('.ts') ? ['--import', 'tsx'] : []), '--max-old-space-size=192', worker], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
            closed = new Promise<void>(resolve => child.once('close', () => resolve()));
            const chunks: Buffer[] = [];
            let size = 0;
            let settled = false;
            const finish = (err?: Error, result?: Decoded) => { if (settled)
                return; settled = true; clearTimeout(timer); if (err) {
                child.kill();
                no(err);
            }
            else
                yes(result!); };
            const timer = setTimeout(() => finish(new AdminError('INVALID_INPUT', '图片处理超时')), Math.min(options.timeoutMs ?? 10000, 10000));
            child.stdout.on('data', (b: Buffer) => { size += b.length; if (size > 66 * 1024 * 1024 + 1024)
                finish(new AdminError('INVALID_INPUT', '图片输出超限'));
            else
                chunks.push(b); });
            child.stderr.on('data', () => { });
            child.stdin.on('error', () => { });
            child.on('error', () => finish(new AdminError('INTERNAL_ERROR', '图片处理不可用')));
            child.on('close', code => { if (settled)
                return; try {
                if (code !== 0)
                    throw new Error('decode');
                const output = Buffer.concat(chunks);
                const end = output.indexOf(10);
                if (end < 1 || end > 1024)
                    throw new Error('header');
                const m: unknown = JSON.parse(output.toString('utf8', 0, end));
                if (!m || typeof m !== 'object')
                    throw new Error('header');
                const h = m as Record<string, unknown>;
                const os = Number(h.originalSize), ts = Number(h.thumbnailSize), width = Number(h.width), height = Number(h.height);
                if (!Number.isSafeInteger(os) || !Number.isSafeInteger(ts) || os < 1 || ts < 1 || os > 64 * 1024 * 1024 || ts > 2 * 1024 * 1024 || end + 1 + os + ts !== output.length || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 6000 || height > 6000 || !['jpeg', 'png', 'webp'].includes(String(h.format)))
                    throw new Error('bounds');
                finish(undefined, { format: String(h.format), width, height, original: output.subarray(end + 1, end + 1 + os), thumbnail: output.subarray(end + 1 + os) });
            }
            catch {
                finish(new AdminError('INVALID_INPUT', '仅接受可完整解码的JPEG、PNG、WebP单页图片'));
            } });
            child.stdin.end(bytes);
        });
    }
    finally {
        await closed;
        active--;
    }
}
async function writeExclusive(path: string, bytes: Buffer) { const f = await open(path, 'wx', 0o600); try {
    await f.writeFile(bytes);
    await f.sync();
}
finally {
    await f.close();
} }
export class MediaStorage {
    readonly root: string;
    constructor(root: string) { if (!root || !isAbsolute(root))
        throw new Error('absolute private media root required'); this.root = resolve(root); }
    async initialize() { await mkdir(this.root, { recursive: true, mode: 0o700 }); if ((await lstat(this.root)).isSymbolicLink())
        throw new Error('media root cannot be a symlink'); }
    async put(bytes: Buffer) { const decoded = await decodeImage(bytes); await this.initialize(); const key = randomUUID(); const staging = join(this.root, `.staging-${key}`); const final = join(this.root, key); await mkdir(staging, { mode: 0o700 }); try {
        await writeExclusive(join(staging, 'original.png'), decoded.original);
        await writeExclusive(join(staging, 'thumbnail.png'), decoded.thumbnail);
        await rename(staging, final);
        return { objectKey: key, format: decoded.format, width: decoded.width, height: decoded.height, originalHash: digest(decoded.original), thumbnailHash: digest(decoded.thumbnail) };
    }
    catch (e) {
        await rm(staging, { recursive: true, force: true }).catch(() => { });
        throw e;
    } }
    async discard(key: string) { idOf(key); await rm(join(this.root, key), { recursive: true, force: true }); }
    async read(key: string, filename: string) { idOf(key); if (!['original.png', 'thumbnail.png'].includes(filename))
        throw new AdminError('NOT_FOUND', '文件不可用'); const dir = join(this.root, key); if ((await lstat(dir)).isSymbolicLink())
        throw new AdminError('NOT_FOUND', '文件不可用'); const path = join(dir, filename); if ((await lstat(path)).isSymbolicLink())
        throw new AdminError('NOT_FOUND', '文件不可用'); return readFile(path); }
}
export async function runBackup(database: ContentDatabase, access: Access, jobId: string, storage: MediaStorage, backupRoot: string) {
    const keys = database.admin.startBackup(access, jobId);
    const dir = join(resolve(backupRoot), jobId);
    try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        database.admin.backupSnapshot(jobId, join(dir, 'content.sqlite'));
        const files: {
            key: string;
            file: string;
            hash: string;
        }[] = [];
        for (const expected of keys) {
            const key = expected.key;
            idOf(key);
            await mkdir(join(dir, key), { mode: 0o700 });
            for (const file of ['original.png', 'thumbnail.png']) {
                const b = await storage.read(key, file);
                if (digest(b) !== (file === 'original.png' ? expected.original : expected.thumbnail))
                    throw new Error('Media ledger hash mismatch');
                await writeExclusive(join(dir, key, file), b);
                files.push({ key, file, hash: digest(b) });
            }
        }
        const dbBytes = await readFile(join(dir, 'content.sqlite'));
        const manifest = JSON.stringify({ version: 1, jobId, databaseHash: digest(dbBytes), files, restoreRequiresSessionRevocation: true }, null, 2);
        await writeExclusive(join(dir, 'manifest.json'), Buffer.from(manifest));
        database.admin.finishBackup(jobId, digest(manifest));
    }
    catch {
        database.admin.finishBackup(jobId, null);
    }
}
export async function inspectPrivateStorage(database:ContentDatabase,storage:MediaStorage,hostsStopped:boolean) {
    const expected=database.admin.storageInventory(hostsStopped);const referenced=new Set(expected.map(e=>e.key));let damaged=0;
    for(const e of expected){try{for(const file of ['original.png','thumbnail.png']){const b=await storage.read(e.key,file);if(digest(b)!==(file==='original.png'?e.original:e.thumbnail))damaged++;}}catch{damaged++;}}
    const entries=await readdir(storage.root);return {referencedObjects:referenced.size,unreferencedPrivateEntries:entries.filter(e=>!referenced.has(e)).length,damagedOrMissingFiles:damaged,automaticDeletion:false};
}
