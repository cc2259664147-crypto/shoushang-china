const fs = require('node:fs'), cp = require('node:child_process'), crypto = require('node:crypto');
const directory = 'docs/qa/evidence/m14-query-performance/';
const baseline = JSON.parse(fs.readFileSync(directory + 'baseline.json', 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const allowed = p => p.startsWith('apps/api/src/content/') || p.startsWith('apps/api/src/database/') || p.startsWith('tests/m14/') || p.startsWith('docs/qa/') || p === 'docs/handoffs/M14-query-performance.md' || ['docs/contracts/change-requests.md', 'docs/contracts/module-api.md', 'docs/contracts/data-model.md'].includes(p);
const mustPreserve = p => p.startsWith('.review-') || p.includes('/evidence/') || p === 'tests/m14/query-load.ts';
const changed = [], missing = [], forbidden = [];
for (const [path, hash] of Object.entries(baseline)) {
  if (!fs.existsSync(path)) { missing.push(path); continue; }
  if (sha(fs.readFileSync(path)) !== hash) { changed.push(path); if (!allowed(path) || mustPreserve(path)) forbidden.push(path); }
}
const files = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
const newOutside = files.filter(p => !(p in baseline) && !allowed(p));
const changedSource = [...changed, ...files.filter(p => !(p in baseline) && allowed(p))].filter(p => !p.includes('/evidence/'));
const content = fs.readFileSync('apps/api/src/database/index.ts', 'utf8');
const reconstructed = content.replaceAll('\r\n', '\n')
  .replace("import type { SQLOutputValue } from 'node:sqlite';\n", '')
  .replace("import { randomUUID } from 'node:crypto';\n", '')
  .replace('interface StoredPublicSnapshot { rows: Record<string, SQLOutputValue>[]; revokedMedia: string[] }\n', '')
  .replace('  private readonly publicReadIdentity = randomUUID();\n', '')
  .replace(/  readPublicSnapshot\(\): StoredPublicSnapshot;[\s\S]*?(?=  \/\*\* VACUUM INTO)/u,
    `  readPublicSnapshot() {\n    return this.transaction(() => ({\n      rows: this.db.prepare("SELECT e.kind,r.payload FROM entities e JOIN revisions r ON r.kind=e.kind AND r.entity_id=e.id AND r.revision=e.public_revision WHERE r.state=?").all('published'),\n      revokedMedia: this.db.prepare('SELECT id FROM revoked_media').all().map(r => String(r.id)),\n    }), false);\n  }\n`);
const baselineV1ToV3Kept = [reconstructed, reconstructed.replaceAll('\n', '\r\n')].some(value => sha(Buffer.from(value)) === baseline['apps/api/src/database/index.ts']);
// Compare normalized line endings too: source edits may preserve Windows CRLF globally.
const dbCheck = { note: 'Existing migrations, write methods, admin integration and initialization text checked by reconstructing the old index around the authorized read-only additions.', reconstructedOriginalHashMatches: baselineV1ToV3Kept };
const defects = fs.readFileSync('docs/qa/defects.md', 'utf8').replaceAll('\r\n', '\n');
const priorDefects = defects.replace(/\n- \*\*M14-2A状态[\s\S]*?(?=\n- 所属：M12)/u, '');
const priorDefectsPreserved = [priorDefects, priorDefects.replaceAll('\n', '\r\n')].some(value => sha(Buffer.from(value)) === baseline['docs/qa/defects.md']);
fs.writeFileSync(directory + 'delivery-files.json', JSON.stringify(changedSource.map(path => ({ path, sha256: sha(fs.readFileSync(path)) })), null, 2));
fs.writeFileSync(directory + 'status-after.txt', cp.execFileSync('git', ['status', '--porcelain=v1']));
const report = { protectedBaselineFiles: Object.keys(baseline).length, changed, missing, forbidden, newOutside, originalLoadUnchanged: sha(fs.readFileSync('tests/m14/query-load.ts')) === baseline['tests/m14/query-load.ts'], priorDefectsPreserved, oldEvidenceCount: Object.keys(baseline).filter(p => p.includes('/evidence/')).length, reviewCount: Object.keys(baseline).filter(p => p.startsWith('.review-')).length, databaseReadOnlyChangeCheck: dbCheck, passed: !missing.length && !forbidden.length && !newOutside.length && baselineV1ToV3Kept && priorDefectsPreserved, scope: 'Git-visible source, prior dirty/untracked files and historical evidence; ignored user databases/profile/cache/dist not read for hashing. Only fresh temp test data used.' };
fs.writeFileSync(directory + 'protection.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
