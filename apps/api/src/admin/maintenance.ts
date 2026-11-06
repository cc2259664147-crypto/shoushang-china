import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ContentDatabase } from '../database';
import { hashPassword } from './security';
import { restoreBackup } from './restore';
import { inspectPrivateStorage, MediaStorage } from './media';
async function passwordInput(): Promise<string> {
    if (!process.stdin.isTTY) {
        let input = '';
        for await (const chunk of process.stdin) {
            input += String(chunk);
            if (input.length > 512)
                throw new Error('Password input too large');
        }
        const lines = input.replace(/\r/gu, '').split('\n');
        if (lines[0] !== lines[1] || !lines[0])
            throw new Error('Password confirmation mismatch');
        return lines[0];
    }
    let muted = false;
    const sink = new Writable({ write(chunk, _encoding, cb) { if (!muted)
            process.stdout.write(chunk); cb(); } });
    const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
    try {
        process.stdout.write('New password (hidden): ');
        muted = true;
        const first = await rl.question('');
        process.stdout.write('\nConfirm password (hidden): ');
        const second = await rl.question('');
        process.stdout.write('\n');
        if (first !== second)
            throw new Error('Password confirmation mismatch');
        return first;
    }
    finally {
        rl.close();
    }
}
export async function maintenance(args: string[]): Promise<void> {
    const [command, path, subject, role] = args;
    if (!command || !path || !isAbsolute(path))
        throw new Error('Explicit absolute database path required');
    if (command === 'restore') {
        if (!subject || !isAbsolute(subject) || role !== '--all-hosts-stopped')
            throw new Error('restore requires backup directory, NEW restore directory and --all-hosts-stopped');
        await restoreBackup({ backupDirectory: path, newDirectory: subject, hostsStopped: true });
        process.stdout.write('Restored into quarantine; all accounts disabled. Reconcile revocations before enabling accounts.\n');
        return;
    }
    const allowed = ['create-account', 'reset-password', 'disable-account', 'enable-account', 'add-category', 'add-tag', 'recover-maintenance','inspect-media'];
    if (!allowed.includes(command))
        throw new Error('Unknown maintenance command');
    const passwordHash = command === 'create-account' || command === 'reset-password' ? await hashPassword(await passwordInput()) : null;
    const db = new ContentDatabase({ path });
    try {
        if (command === 'create-account' || command === 'reset-password') {
            if (!subject || (role !== 'admin' && role !== 'editor'))
                throw new Error('Username and explicit role required');
            const id = db.admin.maintenanceAccount(subject, role, passwordHash!, command === 'reset-password');
            process.stdout.write(`Account operation completed: ${id}\n`);
        }
        else if (command === 'disable-account' || command === 'enable-account') {
            if (!subject)
                throw new Error('Username required');
            db.admin.maintainAccountState(subject, command === 'disable-account');
            process.stdout.write('Account state updated; sessions revoked.\n');
        }
        else if (command === 'add-category' || command === 'add-tag') {
            if (!subject)
                throw new Error('Vocabulary value required');
            db.admin.maintainVocabulary(command === 'add-category' ? 'category' : 'tag', subject);
            process.stdout.write('Vocabulary updated.\n');
        }
        else if(command==='inspect-media') {
            if(!subject||!isAbsolute(subject)||role!=='--all-hosts-stopped')throw new Error('An absolute media root and stopped hosts required');
            process.stdout.write(JSON.stringify(await inspectPrivateStorage(db,new MediaStorage(subject),true))+'\n');
        }
        else {
            if (subject !== '--all-hosts-stopped')
                throw new Error('Stop ALL hosts/copiers first');
            db.admin.recoverMaintenance(true);
            process.stdout.write('Expired maintenance recovered.\n');
        }
    }
    finally {
        db.close();
    }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    void maintenance(process.argv.slice(2)).catch(() => { process.stderr.write('Maintenance failed. No credentials are logged; check command, permissions and protected database state.\n'); process.exitCode = 1; });
