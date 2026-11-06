import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { ContentDatabase } from '../database';
import { digest, idOf, record } from '../database/admin-schema';
import { verifyRestoredDatabase } from '../database/restore';
/** Offline only: restores into a NEW directory, disables all accounts and revokes sessions. */
export async function restoreBackup(options: {
    backupDirectory: string;
    newDirectory: string;
    hostsStopped: boolean;
}) {
    if (!options.hostsStopped || !isAbsolute(options.backupDirectory) || !isAbsolute(options.newDirectory))
        throw new Error('Offline restore requires stopped hosts and absolute paths');
    const root = options.backupDirectory;
    if ((await lstat(root)).isSymbolicLink())
        throw new Error('Backup symlinks forbidden');
    const manifest = record(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as unknown, ['version', 'jobId', 'databaseHash', 'files', 'restoreRequiresSessionRevocation']);
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 100000)
        throw new Error('Invalid manifest');
    const dbBytes = await readFile(join(root, 'content.sqlite'));
    if (digest(dbBytes) !== manifest.databaseHash)
        throw new Error('Database checksum mismatch');
    // A failed restore remains in a private new directory; never switch the host to it automatically.
    await mkdir(options.newDirectory, { mode: 0o700 });
    await mkdir(join(options.newDirectory, 'media'), { mode: 0o700 });
    await writeFile(join(options.newDirectory, 'content.sqlite'), dbBytes, { flag: 'wx', mode: 0o600 });
    for (const entry of manifest.files) {
        const f = record(entry, ['key', 'file', 'hash']);
        const key = idOf(f.key);
        if (f.file !== 'original.png' && f.file !== 'thumbnail.png')
            throw new Error('Invalid manifest path');
        const parent = join(root, key);
        if ((await lstat(parent)).isSymbolicLink() || (await lstat(join(parent, f.file))).isSymbolicLink())
            throw new Error('Backup symlinks forbidden');
        const bytes = await readFile(join(parent, f.file));
        if (digest(bytes) !== f.hash)
            throw new Error('Media checksum mismatch');
        await mkdir(join(options.newDirectory, 'media', key), { recursive: true, mode: 0o700 });
        await writeFile(join(options.newDirectory, 'media', key, f.file), bytes, { flag: 'wx', mode: 0o600 });
    }
    verifyRestoredDatabase(join(options.newDirectory, 'content.sqlite'));
    const db = new ContentDatabase({ path: join(options.newDirectory, 'content.sqlite') });
    try {
        db.admin.prepareRestoredDatabase(true);
    }
    finally {
        db.close();
    }
    return { restored: true, accountsDisabled: true, sessionsRevoked: true, requiresSecurityLedgerReconciliation: true };
}
