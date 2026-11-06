import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { digest } from '../../database/admin-schema';
const require = createRequire(import.meta.url);
const sharpRoot = resolve(dirname(require.resolve('sharp')), '..');
const sharpRequire = createRequire(join(sharpRoot, 'package.json'));
const nativePath = sharpRequire.resolve('@img/sharp-win32-x64/package');
const packages = ['@img/colour', 'detect-libc', 'semver'].map(name => { const p = JSON.parse(readFileSync(sharpRequire.resolve(`${name}/package.json`), 'utf8')) as {
    name: string;
    version: string;
    license: string;
}; return { name: p.name, version: p.version, license: p.license }; });
function files(root: string): string[] { return readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(root, e.name)) : [join(root, e.name)]); }
const nativeRoot = dirname(nativePath);
const report = { node: process.version, platform: process.platform, arch: process.arch, sharp: sharp.versions.sharp, native: JSON.parse(readFileSync(nativePath, 'utf8')) as unknown, versions: sharp.versions, dependencies: packages, notices: files(nativeRoot).filter(p => /licen[cs]e|notice/iu.test(p)).map(p => ({ file: relative(nativeRoot, p), sha256: digest(readFileSync(p)) })), sharpLicenseSha256: digest(readFileSync(join(sharpRoot, 'LICENSE'))) };
writeFileSync(resolve(process.argv[2] ?? 'apps/api/src/admin/evidence/m13-implementation-20261019/sharp-runtime.json'), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ node: report.node, platform: report.platform, arch: report.arch, sharp: report.sharp, nativeNotices: report.notices.length }) + '\n');
