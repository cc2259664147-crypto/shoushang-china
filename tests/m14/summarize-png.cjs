// Recompute derived statistics; never replace the raw rounds or historical data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'docs/qa/evidence/m14-png-performance');
const suffix = process.argv[2] ?? '';
if (!['', '-final', '-uvs-final'].includes(suffix)) throw new Error('Unexpected evidence suffix');
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const original = read('original-five' + suffix + '/samples.json'), phased = read('phased-five' + suffix + '/samples.json');
const before = read('diagnostic-original/samples.json');
if (original.samples.length !== 5 || phased.samples.length !== 5 || phased.samples.some(row => row.failure || !row.result)) throw new Error('Incomplete rounds; inspect raw evidence');
const phases = Object.fromEntries(before.samples[0].phases.map(row => [row.phase, {
  beforeSingleDiagnosticMs: row.duration,
  afterFiveMedianMs: median(phased.samples.map(sample => sample.phases.find(item => item.phase === row.phase).duration)),
}]));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
const pngBefore = hash('diagnostic-original/normal-card.png'), pngAfter = hash('phased-five' + suffix + '/normal-card.png');
const result = {
  historicalMedianMs: 10159.3,
  originalUnmodifiedScriptFiveMs: original.samples.map(row => row.png.milliseconds),
  originalScriptMedianMs: median(original.samples.map(row => row.png.milliseconds)),
  supplementalFiveMs: phased.samples.map(row => row.result.milliseconds),
  supplementalMedianMs: median(phased.samples.map(row => row.result.milliseconds)),
  phases,
  fontBodyBytesEachRound: phased.samples.map(row => row.fonts.reduce((n, font) => n + font.encodedBodySize, 0)),
  noFontRequestsBeforeClickEachRound: phased.samples.map(row => row.fontsBeforeClick === 0),
  originalFontBodyBytes: before.samples[0].fonts[0].encodedBodySize,
  pngBeforeSha256: pngBefore, pngAfterSha256: pngAfter, defaultPngBytesIdentical: pngBefore === pngAfter,
};
fs.writeFileSync(path.join(dir, 'comparison' + suffix + '.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.originalScriptMedianMs > 5000 || result.supplementalMedianMs > 5000) process.exitCode = 1;
