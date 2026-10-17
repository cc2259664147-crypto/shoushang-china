import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
const row = db.prepare('select sqlite_version() as version').get();
console.log(JSON.stringify({ node: process.version, sqlite: row.version, persistence: 'not-initialized' }));
db.close();
