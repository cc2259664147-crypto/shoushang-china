/** M14-3C isolated candidate preflight. It does not grant publication rights. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { WorkSchema } from '@shoushang/contracts';
import { createPapercutCore } from '@shoushang/papercut-core';
import { createArtworkRenderer } from '@shoushang/artwork-renderer';
import { decodeImage } from '../../apps/api/src/admin/media';
import {
    evaluateReadiness,
    magic,
    validateAssets,
    validateDerivatives,
    type Manifest,
    type PreflightDeps,
} from './content-preflight-core';

async function main() {
    const root = resolve('docs/content');
    const args = process.argv.slice(2);
    const strictReadiness = args.includes('--strict-readiness');
    const evidence = args.find(arg => !arg.startsWith('--')) ?? '';
    assert(evidence.includes('m14-3c-teaching-'), 'An isolated teaching evidence path is required');

    const manifest = JSON.parse(readFileSync(join(root, 'assets/m14-3c/manifest.json'), 'utf8')) as Manifest;
    const texts = {
        acquisition: readFileSync(join(root, 'content-acquisition.md'), 'utf8'),
        attribution: readFileSync(join(root, 'ATTRIBUTION.md'), 'utf8'),
        drafts: readFileSync(join(root, 'exhibits-drafts.md'), 'utf8'),
    };
    const assetDir = join(root, 'assets/m14-3c');
    const sharp = createRequire(join(resolve('apps/api'), 'package.json'))('sharp') as (bytes: Buffer) => {
        metadata(): Promise<{ format?: string; width?: number; height?: number }>;
        raw(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer }> };
    };

    const deps: PreflightDeps = {
        readAsset: (name: string) => readFileSync(join(assetDir, name)),
        hasAsset: (name: string) => existsSync(join(assetDir, name)),
        originalMetadata: async (bytes: Buffer) => {
            const meta = await sharp(bytes).metadata();
            return { format: meta.format, width: meta.width, height: meta.height };
        },
        originalRawBytes: async (bytes: Buffer) =>
            (await sharp(bytes).raw().toBuffer({ resolveWithObject: true })).data.length,
        decodeUpload: async (bytes: Buffer) => {
            const decoded = await decodeImage(bytes);
            return {
                format: decoded.format,
                width: decoded.width,
                height: decoded.height,
                original: decoded.original,
                thumbnail: decoded.thumbnail,
            };
        },
    };

    // ---- A. technical file preflight -------------------------------------
    const assetSummary = await validateAssets(manifest, texts, deps);
    const derivativeSummary = await validateDerivatives(manifest, deps);

    const core = createPapercutCore(), renderer = createArtworkRenderer();
    for (const key of ['c01', 'c02', 'c03']) {
        const work = WorkSchema.parse(JSON.parse(readFileSync(join(evidence, `${key}-work.json`), 'utf8')) as unknown);
        assert.equal(work.operations.length, 8);
        assert.equal(new Set(work.operations.map(operation => operation.id)).size, 8);
        assert.equal(new Set(work.operations.map(operation => `${operation.shape}/${operation.center.x}/${operation.center.y}/${operation.width}/${operation.height}/${operation.angleDeg}`)).size, 8);
        assert.equal(work.status, 'completed');
        assert(core.validate(work).ok, `${key} public core validation`);
        assert(renderer.render({ work, width: 1200, height: 1200, view: 'unfolded' }).ok, `${key} public renderer`);
        const png = readFileSync(join(evidence, `${key}-teaching.png`));
        assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
        assert.equal(png.readUInt32BE(16), 1600); assert.equal(png.readUInt32BE(20), 2000);
        const cover = readFileSync(join(root, `assets/m14-3c/story-editorial-s${key.slice(1)}.svg`), 'utf8');
        assert(cover.includes('<svg') && !/<script|<foreignObject|(?:href|src)=["']https?:\/\//i.test(cover));
        assert(magic(png) === 'png');
    }

    // ---- B. twelve-slot readiness (separate result) -----------------------
    const readiness = evaluateReadiness(manifest, texts);

    const technical = {
        technicalFilePreflight: 'passed',
        publicEvidenceFields: 'recorded; not a rights adjudication',
        candidateEvidenceCount: assetSummary.candidateEvidenceCount,
        uniqueAssetHashes: assetSummary.uniqueAssetHashes,
        uniqueUploadHashes: assetSummary.uniqueUploadHashes,
        uploadableDerivatives: derivativeSummary.total,
        derivationRelations: {
            required: derivativeSummary.required,
            extra: derivativeSummary.extra,
            requiredSatisfied: derivativeSummary.requiredSatisfied,
        },
        teachingWorks: 3,
        cutsPerWork: 8,
    };

    console.log(JSON.stringify({
        technicalFilePreflight: technical,
        twelveSlotReadiness: {
            target: readiness.target,
            ready: readiness.ready,
            remaining: readiness.remaining,
            complete: readiness.complete,
            gaps: readiness.gaps.map(gap => `[${gap.kind}] ${gap.detail}`),
        },
        humanEditorialReview: 'pending',
        formalPublication: 'none',
        contentAcceptance: 'NOT GRANTED — machine checks do not adjudicate copyright and do not replace the human content approval',
    }, null, 2));

    if (!readiness.complete) {
        console.error(
            `\nTECHNICAL FILE PREFLIGHT PASSED for ${assetSummary.candidateEvidenceCount} recorded files; ` +
            `twelve-slot readiness is ${readiness.ready}/${readiness.target}: ${readiness.remaining} slot(s) still open. ` +
            `A partial technical pass is not overall content acceptance.`,
        );
    }

    if (strictReadiness) {
        if (!readiness.complete) {
            console.error(`\nSTRICT READINESS CHECK FAILED. Target ${readiness.target}, ready ${readiness.ready}, remaining ${readiness.remaining}.`);
            for (const gap of readiness.gaps) console.error(`  - [${gap.kind}] ${gap.detail}`);
            process.exitCode = 1;
        } else {
            console.log(`\nSTRICT READINESS CHECK PASSED: ${readiness.ready}/${readiness.target} independent works documented.`);
        }
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
