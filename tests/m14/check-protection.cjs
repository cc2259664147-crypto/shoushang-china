const fs = require('node:fs'), cp = require('node:child_process'), crypto = require('node:crypto');
const evidence = 'docs/qa/evidence/m14-1/';
const baseline = JSON.parse(fs.readFileSync(evidence + 'protected-baseline.json', 'utf8'));
const allowed = p => p.startsWith('tests/') || p.startsWith('docs/qa/') || p.startsWith('docs/content/') || p === 'docs/handoffs/M14.md';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const changed = [], missing = [];
for (const [path, sha] of Object.entries(baseline.files)) {
  if (!fs.existsSync(path)) missing.push(path); else if (hash(path) !== sha) changed.push(path);
}
const paths = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
const newOutsideScope = paths.filter(p => !allowed(p) && !(p in baseline.files));
const report = { checkedAt: new Date().toISOString(), protectedFiles: Object.keys(baseline.files).length, reviewFiles: Object.keys(baseline.files).filter(p => p.startsWith('.review-')).length, historicalEvidenceFiles: Object.keys(baseline.files).filter(p => p.includes('/evidence/')).length, changed, missing, newOutsideScope, scope: 'Git-visible existing tracked/untracked files outside authorized directories; ignored build/cache/temp artifacts excluded. Actual user database/profile files were never opened/reset; no assertion of an initial hash for ignored user data.', passed: !changed.length && !missing.length && !newOutsideScope.length };
fs.writeFileSync(evidence + 'protection-final.json', JSON.stringify(report, null, 2));
fs.writeFileSync(evidence + 'git-status-after.txt', cp.execFileSync('git', ['status', '--porcelain=v1']));
const manifest = paths.filter(allowed).filter(p => fs.statSync(p).isFile() && !p.includes('/evidence/')).map(path => ({ path, sha256: hash(path) }));
fs.writeFileSync(evidence + 'delivery-files.json', JSON.stringify(manifest, null, 2));
const matrix = fs.readFileSync('docs/qa/acceptance-matrix.md', 'utf8');
const absent = [...Array.from({ length: 26 }, (_, i) => 'AC-' + String(i + 1).padStart(2, '0')), ...Array.from({ length: 8 }, (_, i) => 'FR-' + String(i + 1).padStart(2, '0')), ...Array.from({ length: 6 }, (_, i) => 'NFR-' + String(i + 1).padStart(2, '0'))].filter(id => !matrix.includes('| ' + id + ' |'));
fs.writeFileSync(evidence + 'matrix-coverage.json', JSON.stringify({ rows: matrix.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| 编号') && !l.startsWith('| ---')).length, absent, note: 'ID completeness/transcription check only; does not imply requirements passed.' }, null, 2));
console.log(JSON.stringify(report));
if (!report.passed || absent.length) process.exitCode = 1;
