const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline'), crypto = require('node:crypto');
async function main() {
  const root = path.resolve(process.argv[2]); const summary = JSON.parse(fs.readFileSync(path.join(root, 'summary.json')));
  let count = 0, errors = 0, maxFinish = 0, badWindow = 0; const times = [], workers = {};
  const stream = fs.createReadStream(path.join(root, 'samples.jsonl'));
  const sha = crypto.createHash('sha256'); stream.on('data', data => sha.update(data));
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
    const row = JSON.parse(line); count++; if (!row.valid) errors++;
    workers[row.worker] = (workers[row.worker] ?? 0) + 1;
    times.push(row.milliseconds); maxFinish = Math.max(maxFinish, row.offset + row.milliseconds);
    if (row.offset < 0 || row.offset >= 300000 || row.milliseconds < 0 || !Number.isFinite(row.milliseconds)) badWindow++;
  }
  times.sort((a, b) => a - b);
  const quantile = p => times[Math.ceil(times.length * p) - 1];
  const report = { count, errors, errorRate: errors / count, workers, badWindow, maxFinishMs: maxFinish, sha256: sha.digest('hex'), p50Ms: quantile(0.5), p95Ms: quantile(0.95), p99Ms: quantile(0.99), passed: count === summary.count && errors === summary.errors && badWindow === 0 && Object.keys(workers).length === 20 && quantile(0.5) === summary.p50Ms && quantile(0.95) === summary.p95Ms && quantile(0.99) === summary.p99Ms && maxFinish <= summary.elapsedMs };
  fs.writeFileSync(path.join(root, 'sample-verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}
void main().catch(error => { console.error(String(error)); process.exitCode = 1; });
