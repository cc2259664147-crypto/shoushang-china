/** Rebuildable raster derivatives for isolated editorial review. Originals stay untouched. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2] ?? 'docs/content/assets/m14-3c');
const requireApi = createRequire(resolve('apps/api/package.json'));
const sharp = requireApi('sharp');
const jobs = [
  ['spring-original.png', 'spring-upload.webp', 'webp'],
  ...[1, 2, 3].map(n => [`story-editorial-s0${n}.svg`, `story-editorial-s0${n}-upload.png`, 'png']),
];
for (const [source, output, format] of jobs) {
  const input = await readFile(join(root, source));
  const pipe = sharp(input, { failOn: 'warning', limitInputPixels: 36_000_000 });
  const bytes = format === 'webp' ? await pipe.webp({ quality: 90, effort: 6 }).toBuffer() : await pipe.png().toBuffer();
  if (bytes.length > 5 * 1024 * 1024) throw new Error(`${output} exceeds upload limit`);
  await writeFile(join(root, output), bytes, { flag: 'wx' });
  console.log(`${source} -> ${output}: ${bytes.length} bytes`);
}
