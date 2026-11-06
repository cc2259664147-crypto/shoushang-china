/**
 * M14-3C preflight boundary tests.
 *
 * Runs against a synthetic asset package built in a temporary directory so the
 * assertions stay valid as the real candidate set grows. Each case states the
 * rule it protects and the failure it must produce.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    evaluateReadiness,
    sha256,
    validateAssets,
    validateDerivatives,
    REQUIRED_DERIVATIONS,
    TARGET_CANDIDATE_SLOTS,
    type Asset,
    type DecodedImage,
    type Derivative,
    type Manifest,
    type PreflightDeps,
    type RasterFormat,
} from './content-preflight-core';

const sharp = createRequire(join(resolve('apps/api'), 'package.json'))('sharp') as {
    (options: { create: { width: number; height: number; channels: number; background: string } }): {
        png(): { toBuffer(): Promise<Buffer> };
        jpeg(): { toBuffer(): Promise<Buffer> };
        webp(): { toBuffer(): Promise<Buffer> };
    };
    (bytes: Buffer): {
        metadata(): Promise<{ format?: string; width?: number; height?: number }>;
        raw(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer }> };
    };
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type Store = Map<string, Buffer>;

function depsFor(store: Store, overrides: Partial<PreflightDeps> = {}): PreflightDeps {
    const base: PreflightDeps = {
        readAsset: name => {
            const found = store.get(name);
            if (!found) throw new Error(`ENOENT ${name}`);
            return found;
        },
        hasAsset: name => store.has(name),
        originalMetadata: async bytes => {
            const meta = await (sharp as (b: Buffer) => { metadata(): Promise<{ format: string | undefined; width: number | undefined; height: number | undefined }> })(bytes).metadata();
            return { format: meta.format, width: meta.width, height: meta.height };
        },
        originalRawBytes: async bytes =>
            (await (sharp as (b: Buffer) => { raw(): { toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer }> } })(bytes).raw().toBuffer({ resolveWithObject: true })).data.length,
        decodeUpload: async (bytes: Buffer): Promise<DecodedImage> => {
            const api = sharp as (b: Buffer) => { metadata(): Promise<{ format?: string; width?: number; height?: number }>; raw(): { toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer }> } };
            const decoded = api(bytes);
            const meta = await decoded.metadata();
            const raw = await decoded.raw().toBuffer({ resolveWithObject: true });
            if (!meta.width || !meta.height) throw new Error('decode failed');
            if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('PAYLOAD_TOO_LARGE 单文件不得超过5MB');
            return {
                format: meta.format ?? 'unsupported',
                width: meta.width,
                height: meta.height,
                original: raw.data,
                thumbnail: raw.data.subarray(0, Math.max(1, Math.floor(raw.data.length / 8))),
            };
        },
    };
    return { ...base, ...overrides };
}

function textsFor(candidates: readonly string[]): { acquisition: string; attribution: string; drafts: string } {
    const drafts = candidates.map(id =>
        `| ${id} / \`synthetic\` | draft body for ${id} with enough text to look real | author | alt text | source |`,
    ).join('\n');
    return {
        acquisition: candidates.join(' '),
        attribution: candidates.join(' '),
        drafts,
    };
}

function texts(): { acquisition: string; attribution: string; drafts: string } {
    return textsFor(['E-R01', 'E-R02', 'E-R03', 'S-C01', 'S-C02', 'S-C03']);
}

async function makePackage(): Promise<{ store: Store; manifest: Manifest }> {
    const store: Store = new Map<string, Buffer>();
    const assets: Asset[] = [];
    const derivations: Derivative[] = [];

    const originalSpecs = [
        { candidate: 'E-R01', file: 'spring-original.png', uploadFile: 'spring-upload.webp', format: 'PNG', uploadFormat: 'webp' as RasterFormat, background: 'red' },
        { candidate: 'E-R02', file: 'pig-original.jpg', uploadFile: 'pig-original.jpg', format: 'JPEG', uploadFormat: 'jpeg' as RasterFormat, background: 'blue' },
        { candidate: 'E-R03', file: 'dog-original.jpg', uploadFile: 'dog-original.jpg', format: 'JPEG', uploadFormat: 'jpeg' as RasterFormat, background: 'green' },
    ];

    for (const spec of originalSpecs) {
        const width = 64, height = 48;
        const factory = sharp({ create: { width, height, channels: 3, background: spec.background } });
        const original = spec.format === 'PNG'
            ? await factory.png().toBuffer()
            : await factory.jpeg().toBuffer();
        store.set(spec.file, original);
        const isDerived = spec.file !== spec.uploadFile;
        let upload = original;
        if (isDerived) {
            upload = await sharp({ create: { width, height, channels: 3, background: 'yellow' } }).webp().toBuffer();
            store.set(spec.uploadFile, upload);
            derivations.push({
                candidate: spec.candidate, file: spec.uploadFile, derivedFrom: spec.file, sourceSha256: sha256(original),
                format: 'webp', width, height, bytes: upload.length, sha256: sha256(upload),
                modification: 'size-preserving format conversion for upload',
            });
        }
        assets.push({
            candidate: spec.candidate, file: spec.file,
            originalTitle: `${spec.candidate} original`, editorialTitle: `${spec.candidate} title`,
            workAuthorClaim: 'author claim', imageAuthorClaim: 'image claim',
            filePage: 'https://example.org/file', originalUrl: 'https://example.org/original',
            license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode.en',
            width, height, format: spec.format, bytes: original.length, sha256: sha256(original),
            modification: 'not modified', rightsQuestion: 'pending human review',
            workKey: `synthetic:${spec.candidate}`, sourcePage: 'https://example.org/file',
            accessedAt: '2026-10-20', credit: `${spec.candidate} credit`,
            candidateBasis: 'file page verified', editorialStatus: '文案待人工审', publicationStatus: '未入库未发布',
            uploadFile: spec.uploadFile,
        });
    }

    // Three story covers: SVG sources with rasterised upload derivatives.
    for (const n of [1, 2, 3]) {
        const sourceName = `story-editorial-s0${n}.svg`;
        const uploadName = `story-editorial-s0${n}-upload.png`;
        const source = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#c00"/></svg>`, 'utf8');
        store.set(sourceName, source);
        const upload = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'green' } }).png().toBuffer();
        store.set(uploadName, upload);
        derivations.push({
            candidate: `S-C0${n}`, file: uploadName, derivedFrom: sourceName, sourceSha256: sha256(source),
            format: 'png', width: 32, height: 32, bytes: upload.length, sha256: sha256(upload),
            modification: 'svg rasterised for upload; not an independent work',
        });
    }

    return {
        store,
        manifest: {
            auditDate: '2026-10-20',
            derivation: { files: derivations },
            files: assets,
        },
    };
}

async function expectFailure(label: string, fn: () => Promise<unknown>): Promise<void> {
    let threw = false;
    try {
        await fn();
    } catch {
        threw = true;
    }
    assert(threw, `${label}: expected a validation failure`);
    console.log(`  ok  ${label} -> rejected`);
}

async function expectPass(label: string, fn: () => Promise<unknown>): Promise<void> {
    await fn();
    console.log(`  ok  ${label} -> accepted`);
}

async function main(): Promise<void> {
    const tmp = mkdtempSync(join(tmpdir(), 'm14-3c-preflight-'));
    console.log(`boundary fixtures in ${tmp}`);
    try {
        const { store, manifest } = await makePackage();
        const t = texts();

        console.log('\n[1] required derivation relations are present');
        assert.equal(REQUIRED_DERIVATIONS.length, 4);
        for (const required of REQUIRED_DERIVATIONS) {
            assert(
                manifest.derivation.files.some(d => d.candidate === required.candidate && d.file === required.file && d.derivedFrom === required.derivedFrom),
                `required relation ${required.candidate} must exist in the fixture`,
            );
        }
        await expectPass('baseline package', async () => {
            await validateAssets(manifest, t, depsFor(store));
            await validateDerivatives(manifest, depsFor(store));
        });

        console.log('\n[2] a new derivation record is allowed and must fully validate');
        {
            const extra = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'yellow' } }).jpeg().toBuffer();
            store.set('extra-original.png', await sharp({ create: { width: 40, height: 30, channels: 3, background: 'white' } }).png().toBuffer());
            store.set('extra-upload.jpeg', extra);
            const extraSourceHash = sha256(store.get('extra-original.png')!);
            const grown: Manifest = {
                ...manifest,
                derivation: {
                    files: [...manifest.derivation.files, {
                        candidate: 'E-R01', file: 'extra-upload.jpeg', derivedFrom: 'extra-original.png', sourceSha256: extraSourceHash,
                        format: 'jpeg', width: 40, height: 30, bytes: extra.length, sha256: sha256(extra),
                        modification: 'downscaled jpeg for upload',
                    }],
                },
            };
            await expectPass('extra derivation recorded', async () => {
                const summary = await validateDerivatives(grown, depsFor(store));
                assert.equal(summary.total, 5);
                assert.equal(summary.extra, 1);
                assert.equal(summary.required, 4);
            });
        }

        console.log('\n[3] removing a required derivation relation must fail');
        {
            const trimmed: Manifest = {
                ...manifest,
                derivation: { files: manifest.derivation.files.filter(d => !(d.candidate === 'S-C02' && d.file === 'story-editorial-s02-upload.png')) },
            };
            await expectFailure('missing required derivation', () => validateDerivatives(trimmed, depsFor(store)));
        }

        console.log('\n[4] a wrong output hash must fail');
        {
            const broken: Manifest = {
                ...manifest,
                derivation: {
                    files: manifest.derivation.files.map(d =>
                        d.file === 'spring-upload.webp' ? { ...d, sha256: '0'.repeat(64) } : d),
                },
            };
            await expectFailure('derivative output hash mismatch', () => validateDerivatives(broken, depsFor(store)));
        }

        console.log('\n[5] a wrong source hash must fail');
        {
            const broken: Manifest = {
                ...manifest,
                derivation: {
                    files: manifest.derivation.files.map(d =>
                        d.file === 'spring-upload.webp' ? { ...d, sourceSha256: '1'.repeat(64) } : d),
                },
            };
            await expectFailure('derivative source hash mismatch', () => validateDerivatives(broken, depsFor(store)));
        }

        console.log('\n[6] an unresolvable source must fail');
        {
            const files = manifest.derivation.files.map(d => {
                if (d.file !== 'spring-upload.webp') return d;
                const withoutSource: Derivative = { ...d, derivedFrom: 'not-there.png' };
                delete withoutSource.sourceSha256;
                return withoutSource;
            });
            const broken: Manifest = { ...manifest, derivation: { files } };
            await expectFailure('untraceable derivation source', () => validateDerivatives(broken, depsFor(store)));
        }

        console.log('\n[7] an oversized upload must fail');
        {
            const big = Buffer.concat([store.get('extra-upload.jpeg') ?? Buffer.from([255, 216, 255]), Buffer.alloc(MAX_UPLOAD_BYTES)]);
            store.set('oversized.jpeg', big);
            const sourceBuf = store.get('extra-original.png')!;
            const grown: Manifest = {
                ...manifest,
                derivation: {
                    files: [...manifest.derivation.files, {
                        candidate: 'E-R02', file: 'oversized.jpeg', derivedFrom: 'extra-original.png', sourceSha256: sha256(sourceBuf),
                        format: 'jpeg', width: 40, height: 30, bytes: big.length, sha256: sha256(big),
                        modification: 'deliberately oversized',
                    }],
                },
            };
            await expectFailure('oversized derivative', () => validateDerivatives(grown, depsFor(store)));
        }

        console.log('\n[8] a disallowed container format must fail');
        {
            const bogus = Buffer.from('not an image at all', 'utf8');
            store.set('bogus.png', bogus);
            const sourceBuf = store.get('extra-original.png')!;
            const grown: Manifest = {
                ...manifest,
                derivation: {
                    files: [...manifest.derivation.files, {
                        candidate: 'E-R03', file: 'bogus.png', derivedFrom: 'extra-original.png', sourceSha256: sha256(sourceBuf),
                        format: 'png', width: 40, height: 30, bytes: bogus.length, sha256: sha256(bogus),
                        modification: 'bytes claim png but are not',
                    }],
                },
            };
            await expectFailure('illegal format', () => validateDerivatives(grown, depsFor(store)));
        }

        console.log('\n[9] a recorded hash that does not match the bytes must fail');
        {
            const broken: Manifest = {
                ...manifest,
                files: manifest.files.map(f => f.candidate === 'E-R03' ? { ...f, sha256: '2'.repeat(64) } : f),
            };
            await expectFailure('asset hash mismatch', () => validateAssets(broken, t, depsFor(store)));
        }

        console.log('\n[10] duplicate original bytes cannot count as two works');
        {
            const pig = manifest.files.find(item => item.candidate === 'E-R02');
            assert(pig, 'fixture must contain E-R02');
            const clone: Asset = { ...pig, candidate: 'E-R99', workKey: 'synthetic:E-R99', file: 'pig-original.jpg', uploadFile: 'pig-original.jpg' };
            const broken: Manifest = { ...manifest, files: [...manifest.files, clone] };
            await expectFailure('duplicate asset bytes', () => validateAssets(broken, t, depsFor(store)));
        }

        console.log('\n[11] readiness is separate from the technical preflight');
        {
            const draftRow = (f: Asset): string =>
                `| ${f.candidate} / \`${f.workKey}\` | **测试题名**。摘要：独立剪纸作品。正文：此件为独立图像，描述可见构图。 | 作者未注明；地区未注明；剪纸作品。 | alt：黑纸剪纸人物图案。图注：独立作品图。 | [来源页](https://example.org/work/${f.candidate})；许可待审。 |`;
            const short = evaluateReadiness({ ...manifest, files: manifest.files.slice(0, 2) }, {
                drafts: manifest.files.slice(0, 2).map(draftRow).join('\n'),
            });
            assert.equal(short.target, TARGET_CANDIDATE_SLOTS);
            assert.equal(short.ready, 2);
            assert.equal(short.remaining, TARGET_CANDIDATE_SLOTS - 2);
            assert.equal(short.complete, false);
            assert(short.gaps.some(gap => gap.kind === 'missing-slot'), 'missing slots must be listed');
            console.log(`  ok  partial package -> ready=${short.ready} remaining=${short.remaining} gaps=${short.gaps.length}`);

            const full: Asset[] = [];
            const template = manifest.files.find(item => item.candidate === 'E-R01');
            assert(template, 'fixture must contain E-R01');
            for (let index = 1; index <= TARGET_CANDIDATE_SLOTS; index++) {
                full.push({
                    ...template,
                    candidate: `E-R${String(index).padStart(2, '0')}`,
                    workKey: `synthetic:slot-${index}`,
                    file: `slot-${index}.png`,
                    uploadFile: `slot-${index}.png`,
                });
            }
            const fullDrafts = full.map(draftRow).join('\n');
            const complete = evaluateReadiness({ ...manifest, files: full }, { drafts: fullDrafts });
            assert.equal(complete.ready, TARGET_CANDIDATE_SLOTS);
            assert.equal(complete.remaining, 0);
            assert.equal(complete.complete, true);
            console.log(`  ok  full package -> ready=${complete.ready} remaining=${complete.remaining} complete=${complete.complete}`);

            const emptyFields = [
                ['summary', '摘要：独立剪纸作品。', '摘要：。'],
                ['body', '正文：此件为独立图像，描述可见构图。', '正文：。'],
                ['alt', 'alt：黑纸剪纸人物图案。', 'alt：。'],
            ] as const;
            for (const [label, original, blank] of emptyFields) {
                const result = evaluateReadiness({ ...manifest, files: full }, { drafts: fullDrafts.replace(original, blank) });
                assert.equal(result.complete, false, `blank ${label} must block readiness`);
                assert.equal(result.ready, TARGET_CANDIDATE_SLOTS - 1, `blank ${label} must not count as ready`);
                assert(result.gaps.some(gap => gap.kind === 'incomplete-draft'));
                console.log(`  ok  blank ${label} -> ready=${result.ready} complete=false`);
            }
            const idOnly = full.map(f => `| ${f.candidate} / \`${f.workKey}\` | | | | |`).join('\n');
            const allBlank = evaluateReadiness({ ...manifest, files: full }, { drafts: idOnly });
            assert.equal(allBlank.ready, 0);
            assert.equal(allBlank.complete, false);
            console.log('  ok  twelve id-only rows -> ready=0 complete=false');

            const rightsPending: Manifest = {
                ...manifest,
                files: full.map(f => f.candidate === 'E-R11' || f.candidate === 'E-R12'
                    ? { ...f, rightsBasisStatus: 'unverified' as const } : f),
            };
            const withRightsGap = evaluateReadiness(rightsPending, { drafts: fullDrafts });
            assert.equal(withRightsGap.ready, TARGET_CANDIDATE_SLOTS - 2);
            assert.equal(withRightsGap.complete, false);
            assert.equal(withRightsGap.gaps.filter(gap => gap.kind === 'rights-unverified').length, 2);
            console.log('  ok  two rights-unverified works -> ready=10 complete=false');
        }

        console.log('\nAll boundary cases behaved as specified.');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
        assert(!existsSync(tmp), 'fixture directory cleaned up');
        void readFileSync;
        void writeFileSync;
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
