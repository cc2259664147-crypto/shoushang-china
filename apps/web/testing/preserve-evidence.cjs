// Test-process only. Preserve every prior screenshot; redirect new evidence PNG writes.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const permitted = path.join(root, 'docs/api/evidence') + path.sep;
const run = process.env.M12_EVIDENCE_RUN && path.resolve(process.env.M12_EVIDENCE_RUN);
if (run && run.startsWith(permitted)) {
  const destination = value => {
    if (typeof value !== 'string' && !Buffer.isBuffer(value)) return value;
    const absolute = path.resolve(String(value)), relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || absolute.startsWith(run + path.sep)
      || !relative.split(path.sep).includes('evidence') || path.extname(absolute) !== '.png') return value;
    const target = path.join(run, 'screenshots', relative); fs.mkdirSync(path.dirname(target), { recursive: true }); return target;
  };
  const promiseWrite = fs.promises.writeFile.bind(fs.promises);
  fs.promises.writeFile = (file, ...args) => promiseWrite(destination(file), ...args);
  const callbackWrite = fs.writeFile.bind(fs);
  fs.writeFile = (file, ...args) => callbackWrite(destination(file), ...args);
  const syncWrite = fs.writeFileSync.bind(fs);
  fs.writeFileSync = (file, ...args) => syncWrite(destination(file), ...args);
}
