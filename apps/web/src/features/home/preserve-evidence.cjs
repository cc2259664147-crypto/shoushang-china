// Test-process preload. Redirect PNG evidence writes without touching prior evidence.
// Usage: NODE_OPTIONS=--require=<absolute path to this file>
//        M11_EVIDENCE_RUN=<absolute directory inside home/evidence>
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../../..');
const evidenceRoot = path.join(__dirname, 'evidence') + path.sep;
const run = process.env.M11_EVIDENCE_RUN && path.resolve(process.env.M11_EVIDENCE_RUN);
if (run && run.startsWith(evidenceRoot)) {
  const destination = value => {
    if (typeof value !== 'string' && !Buffer.isBuffer(value)) return value;
    const absolute = path.resolve(String(value));
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || absolute.startsWith(run + path.sep)
      || !relative.split(path.sep).includes('evidence') || path.extname(absolute) !== '.png') return value;
    const target = path.join(run, 'screenshots', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    return target;
  };
  const write = fs.promises.writeFile.bind(fs.promises);
  fs.promises.writeFile = (file, ...args) => write(destination(file), ...args);
  const callbackWrite = fs.writeFile.bind(fs);
  fs.writeFile = (file, ...args) => callbackWrite(destination(file), ...args);
  const syncWrite = fs.writeFileSync.bind(fs);
  fs.writeFileSync = (file, ...args) => syncWrite(destination(file), ...args);
}
