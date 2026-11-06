// Compare Git-visible source/evidence only; never enumerate ignored user data.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const evidence = path.join(root, 'docs/qa/evidence/m14-png-performance');
const baseline = JSON.parse(fs.readFileSync(path.join(evidence, 'baseline.json'), 'utf8'));
const allowedExisting = new Set([
  'packages/artwork-exporter/src/index.ts',
  'apps/web/src/features/workshop/WorkCardExport.tsx',
  'apps/web/src/features/workshop/work-card-export.m08.spec.ts',
  'docs/qa/defects.md', 'docs/qa/performance-report.md',
]);
const allowedNew = file => /^(packages\/artwork-exporter\/src\/|tests\/m14\/|docs\/qa\/)/u.test(file)
  || file === 'docs/handoffs/M14-png-performance.md';
const changed = [], deleted = [];
for (const [file, before] of Object.entries(baseline)) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) { deleted.push(file); continue; }
  const after = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  if (before !== after) changed.push(file);
}
const current = [...new Set(cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
const added = current.filter(file => !(file in baseline));
const unauthorized = [...changed.filter(file => !allowedExisting.has(file)), ...added.filter(file => !allowedNew(file))];
const result = { baselineFiles: Object.keys(baseline).length, unchangedExisting: Object.keys(baseline).length - changed.length - deleted.length,
  changedExisting: changed, deleted, addedFiles: added.length, unauthorized,
  pass: !unauthorized.length && !deleted.length,
  scope: 'All pre-existing Git-visible files, including .review-*, historical evidence, original fonts/licenses, query implementation/tests/evidence; ignored user data never read.' };
fs.writeFileSync(path.join(evidence, 'protection.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
