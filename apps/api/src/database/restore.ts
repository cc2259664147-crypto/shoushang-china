import { DatabaseSync } from 'node:sqlite';
/** Read-only structural verification; never returns raw records or a connection. */
export function verifyRestoredDatabase(path: string): void {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        const result = db.prepare('PRAGMA integrity_check').all();
        if (result.length !== 1 || result[0]!.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
            throw new Error('Restored database failed integrity verification');
    }
    finally {
        db.close();
    }
}
