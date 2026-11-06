/**
 * M14-3C candidate asset validation core.
 *
 * Machine checks only: they verify that recorded files are technically
 * consistent and traceable. They do NOT grant publication rights and they do
 * NOT replace the human content approval.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export type RasterFormat = 'png' | 'jpeg' | 'webp';

export type Asset = {
    candidate: string; file: string; originalTitle: string; editorialTitle: string;
    workAuthorClaim: string; imageAuthorClaim: string; filePage: string; originalUrl: string;
    license: string; licenseUrl: string; width: number; height: number; format: string;
    bytes: number; sha256: string; modification: string; rightsQuestion: string;
    workKey: string; sourcePage: string; accessedAt: string; credit: string;
    candidateBasis: string; editorialStatus: string; publicationStatus: string; uploadFile: string;
    rightsBasisStatus?: 'documented' | 'unverified';
};

export type Derivative = {
    candidate: string; file: string; derivedFrom: string; sourceSha256?: string;
    format: RasterFormat; width: number; height: number;
    bytes: number; sha256: string; modification: string;
};

export type Manifest = {
    auditDate?: string;
    status?: string;
    derivation: { tool?: string; command?: string; note?: string; files: Derivative[] };
    files: Asset[];
    archivedFiles?: Asset[];
};

/** Decoded raster as produced by the admin media pipeline. */
export type DecodedImage = {
    format: string;
    width: number;
    height: number;
    original: Buffer;
    thumbnail: Buffer;
};

/** Everything the core needs from the outside world; tests substitute it. */
export type PreflightDeps = {
    /** Bytes of a file living in the candidate asset directory. */
    readAsset(name: string): Buffer;
    /** Existence check used to report clearer errors for missing optional sources. */
    hasAsset(name: string): boolean;
    /** Full-pixel metadata of an original file (sharp.metadata). */
    originalMetadata(bytes: Buffer): Promise<{ format: string | undefined; width: number | undefined; height: number | undefined }>;
    /** Complete pixel decode of an original file; resolves with a non-empty payload. */
    originalRawBytes(bytes: Buffer): Promise<number>;
    /** Admin `decodeImage` path: full decode plus thumbnail generation. */
    decodeUpload(bytes: Buffer): Promise<DecodedImage>;
};

export type AssetSummary = {
    candidateEvidenceCount: number;
    uniqueAssetHashes: number;
    uniqueUploadHashes: number;
    uploadableDerivatives: number;
};

export type DerivativeSummary = {
    total: number;
    required: number;
    extra: number;
    requiredSatisfied: boolean;
};

/**
 * The four derivation relations that were part of the first M14-3C delivery.
 * They must always remain present and traceable. Additional derivations are
 * allowed and are validated by exactly the same rules.
 */
export const REQUIRED_DERIVATIONS: ReadonlyArray<Readonly<Partial<Derivative>>> = [
    { candidate: 'E-R01', file: 'spring-upload.webp', derivedFrom: 'spring-original.png' },
    { candidate: 'S-C01', file: 'story-editorial-s01-upload.png', derivedFrom: 'story-editorial-s01.svg' },
    { candidate: 'S-C02', file: 'story-editorial-s02-upload.png', derivedFrom: 'story-editorial-s02.svg' },
    { candidate: 'S-C03', file: 'story-editorial-s03-upload.png', derivedFrom: 'story-editorial-s03.svg' },
];

/** Independent work slots that a complete content package must fill. */
export const TARGET_CANDIDATE_SLOTS = 12;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function magic(bytes: Buffer): RasterFormat | 'unsupported' {
    if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return 'unsupported';
}

export function sha256(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export const safeName = (name: string): boolean =>
    /^[a-z0-9][a-z0-9._-]*$/i.test(name) && !name.includes('..');

const isPublicFieldClean = (field: string): boolean =>
    !/proofRef|passwordHash|C:\\Users\\|\.review-|PRIVATE KEY/i.test(field);

/**
 * Validate every recorded original work and its uploadable file.
 *
 * Each work must map to exactly one original, exactly one upload file and
 * exactly one draft row. Files are de-duplicated by content hash so that the
 * same bytes cannot be counted twice as independent works.
 */
export async function validateAssets(
    manifest: Manifest,
    texts: { acquisition: string; attribution: string; drafts: string },
    deps: PreflightDeps,
): Promise<AssetSummary> {
    const assets = manifest.files;
    assert(assets.length >= 3, 'Preserve the three previously acquired works');
    assert.equal(new Set(assets.map(item => item.candidate)).size, assets.length, 'Duplicate candidate ids');
    assert.equal(new Set(assets.map(item => item.workKey)).size, assets.length, 'One work cannot count twice');
    assert.equal(new Set(assets.map(item => item.file)).size, assets.length, 'Duplicate original file names');
    assert.equal(new Set(assets.map(item => item.uploadFile)).size, assets.length, 'One upload image cannot count twice');

    const currentIds = new Set(assets.map(item => item.candidate));
    const draftIds = [...texts.drafts.matchAll(/^\| (E-R\d{2}) \/ `/gm)].map(match => match[1]).filter(id => currentIds.has(id!));
    assert.deepEqual(
        new Set(draftIds),
        new Set(assets.map(item => item.candidate)),
        'Each proposed work needs exactly one draft',
    );
    assert.equal(draftIds.length, assets.length, 'No duplicate candidate draft rows');

    const hashes = new Set<string>();
    const uploadHashes = new Set<string>();
    for (const item of assets) {
        assert(/^E-R\d{2}$/.test(item.candidate) && item.workKey && safeName(item.file) && safeName(item.uploadFile), `${item.candidate} id/path shape`);
        assert(item.sourcePage.startsWith('https://') && item.filePage.startsWith('https://') && item.originalUrl.startsWith('https://'), `${item.candidate} source urls`);
        assert(/^\d{4}-\d{2}-\d{2}$/.test(item.accessedAt), `${item.candidate} accessedAt`);
        assert(item.license && item.licenseUrl.startsWith('https://') && item.credit && item.candidateBasis, `${item.candidate} license/credit`);
        assert(item.workAuthorClaim && item.imageAuthorClaim && item.rightsQuestion && item.modification, `${item.candidate} author/rights fields`);
        assert.equal(item.editorialStatus, '文案待人工审', `${item.candidate} editorialStatus`);
        assert.equal(item.publicationStatus, '未入库未发布', `${item.candidate} publicationStatus`);
        assert(texts.acquisition.includes(item.candidate) && texts.attribution.includes(item.candidate) && texts.drafts.includes(item.candidate), `${item.candidate} must appear in acquisition, attribution and drafts`);
        for (const field of [item.editorialTitle, item.credit, item.candidateBasis]) {
            assert(isPublicFieldClean(field), `${item.candidate} public text contains private material`);
        }

        const bytes = deps.readAsset(item.file);
        assert.equal(bytes.length, item.bytes, `${item.file} byte count`);
        assert.equal(sha256(bytes), item.sha256, `${item.file} hash`);
        const hash = sha256(bytes);
        assert(!hashes.has(hash), 'Duplicate bytes cannot count as separate works');
        hashes.add(hash);
        assert.equal(magic(bytes), item.format.toLowerCase(), `${item.file} format`);

        const meta = await deps.originalMetadata(bytes);
        assert.equal(meta.format, item.format.toLowerCase(), `${item.file} metadata format`);
        assert.equal(meta.width, item.width, `${item.file} metadata width`);
        assert.equal(meta.height, item.height, `${item.file} metadata height`);
        assert((await deps.originalRawBytes(bytes)) > 0, `${item.file} complete original decode`);

        const upload = item.uploadFile === item.file ? bytes : deps.readAsset(item.uploadFile);
        if (item.uploadFile !== item.file) {
            assert(
                manifest.derivation.files.some(derived =>
                    derived.candidate === item.candidate && derived.file === item.uploadFile && derived.derivedFrom === item.file),
                `${item.candidate} upload must be traced to its original`,
            );
        }
        const uploadHash = sha256(upload);
        assert(!uploadHashes.has(uploadHash), 'Duplicate upload bytes cannot count as separate works');
        uploadHashes.add(uploadHash);
        assert(upload.length <= MAX_UPLOAD_BYTES, `${item.candidate} upload size`);

        const actual = await deps.decodeUpload(upload);
        assert.equal(actual.width, item.width, `${item.candidate} upload width`);
        assert.equal(actual.height, item.height, `${item.candidate} upload height`);
        assert.equal(actual.format, magic(upload), `${item.candidate} upload format`);
        assert(actual.original.length > 0 && actual.thumbnail.length > 0, `${item.candidate} upload decode`);
    }

    return {
        candidateEvidenceCount: assets.length,
        uniqueAssetHashes: hashes.size,
        uniqueUploadHashes: uploadHashes.size,
        uploadableDerivatives: manifest.derivation.files.length,
    };
}

/**
 * Validate derivation records.
 *
 * The four historical relations must exist. Any number of additional
 * derivations may be recorded; every one of them is checked for a resolvable
 * source, a matching source hash, a matching output hash, an allowed raster
 * format, the upload size ceiling, exact decoded dimensions, complete pixel
 * decode and thumbnail generation.
 */
export async function validateDerivatives(
    manifest: Manifest,
    deps: PreflightDeps,
): Promise<DerivativeSummary> {
    const derivatives = manifest.derivation.files;
    assert(derivatives.length >= REQUIRED_DERIVATIONS.length, 'At least the historical derivations must be recorded');

    const keys = new Set(derivatives.map(item => `${item.candidate}/${item.file}`));
    assert.equal(keys.size, derivatives.length, 'Duplicate derivation records');

    for (const required of REQUIRED_DERIVATIONS) {
        assert(
            derivatives.some(item =>
                item.candidate === required.candidate &&
                item.file === required.file &&
                item.derivedFrom === required.derivedFrom),
            `Required derivation missing: ${required.candidate} ${required.file} <- ${required.derivedFrom}`,
        );
    }

    for (const item of derivatives) {
        assert(safeName(item.file) && safeName(item.derivedFrom), `${item.file} path shape`);
        assert(item.modification && item.file !== item.derivedFrom, `${item.file} must record a modification and differ from its source`);
        assert(['png', 'jpeg', 'webp'].includes(item.format), `${item.file} format allowlist`);

        assert(deps.hasAsset(item.derivedFrom), `${item.file} source ${item.derivedFrom} cannot be resolved`);
        const source = deps.readAsset(item.derivedFrom);
        const sourceHash = sha256(source);
        const recordedSource = item.sourceSha256
            ?? manifest.files.find(original => original.file === item.derivedFrom)?.sha256;
        assert(recordedSource, `${item.file} source hash is not recorded`);
        assert.equal(sourceHash, recordedSource, `${item.file} source hash mismatch`);

        const bytes = deps.readAsset(item.file);
        assert.equal(bytes.length, item.bytes, `${item.file} byte count`);
        assert(bytes.length > 0 && bytes.length <= MAX_UPLOAD_BYTES, `${item.file} upload size`);
        assert.equal(sha256(bytes), item.sha256, `${item.file} hash`);
        assert.equal(magic(bytes), item.format, `${item.file} magic/format`);

        const decoded = await deps.decodeUpload(bytes);
        assert.equal(decoded.format, item.format, `${item.file} decoded format`);
        assert.equal(decoded.width, item.width, `${item.file} decoded width`);
        assert.equal(decoded.height, item.height, `${item.file} decoded height`);
        assert(decoded.original.length > 0 && decoded.thumbnail.length > 0, `${item.file} complete upload decode`);
    }

    return {
        total: derivatives.length,
        required: REQUIRED_DERIVATIONS.length,
        extra: derivatives.length - REQUIRED_DERIVATIONS.length,
        requiredSatisfied: true,
    };
}

export type ReadinessGap = {
    kind: 'missing-slot' | 'duplicate-work' | 'incomplete-draft' | 'rights-unverified';
    detail: string;
};

export type ReadinessReport = {
    target: number;
    ready: number;
    remaining: number;
    complete: boolean;
    gaps: ReadinessGap[];
};

/**
 * Twelve-slot readiness: counts independent, individually documented works.
 *
 * This is deliberately separate from the technical file preflight. Passing the
 * file checks says nothing about whether the content package is complete, and
 * a partial result must never be reported as overall content acceptance.
 */
export function evaluateReadiness(manifest: Manifest, texts: { drafts: string }): ReadinessReport {
    const assets = manifest.files;
    const gaps: ReadinessGap[] = [];
    const rows = new Map<string, string[]>();
    for (const line of texts.drafts.split(/\r?\n/)) {
        const id = /^\|\s*(E-R\d{2})\s*\//.exec(line)?.[1];
        if (!id) continue;
        const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
        if (rows.has(id)) gaps.push({ kind: 'incomplete-draft', detail: `${id} has duplicate draft rows` });
        rows.set(id, cells);
    }
    const meaningful = (value: string): boolean =>
        /[\p{L}\p{N}]/u.test(value) && !/^(?:待补|待核验|未补|暂无|TODO|TBD)$/i.test(value.trim());
    const extracted = (value: string, pattern: RegExp): string => pattern.exec(value)?.[1]?.trim() ?? '';
    const completeDraft = (item: Asset): boolean => {
        const cells = rows.get(item.candidate);
        if (!cells || cells.length !== 5 || !cells[0]?.includes(`\`${item.workKey}\``)) return false;
        const [identity = '', description = '', metadata = '', image = '', source = ''] = cells;
        const title = extracted(description, /\*\*([^*]+)\*\*/u);
        const summary = extracted(description, /摘要：(.+?)。正文：/u);
        const body = extracted(description, /正文：(.+)/u);
        const alt = extracted(image, /alt：([^。]+)/u);
        const caption = extracted(image, /图注：(.+)/u);
        return meaningful(identity) && meaningful(title) && meaningful(summary) &&
            meaningful(body) && meaningful(metadata) && meaningful(alt) &&
            meaningful(caption) && meaningful(source) && /https:\/\//u.test(source);
    };
    const seenWorkKeys = new Set<string>();
    let ready = 0;
    for (const item of assets) {
        const duplicate = seenWorkKeys.has(item.workKey);
        if (duplicate) {
            gaps.push({ kind: 'duplicate-work', detail: `${item.candidate} reuses work key ${item.workKey}` });
        }
        seenWorkKeys.add(item.workKey);
        const draftValid = completeDraft(item);
        if (!draftValid) {
            gaps.push({ kind: 'incomplete-draft', detail: `${item.candidate} needs title, summary, body, metadata, alt, caption and source in its own row` });
        }
        const rightsValid = item.rightsBasisStatus !== 'unverified';
        if (!rightsValid) {
            gaps.push({ kind: 'rights-unverified', detail: `${item.candidate} has unresolved underlying work / plate / book rights` });
        }
        if (!duplicate && draftValid && rightsValid) ready++;
    }

    const remaining = Math.max(0, TARGET_CANDIDATE_SLOTS - ready);
    for (let slot = seenWorkKeys.size + 1; slot <= TARGET_CANDIDATE_SLOTS; slot++) {
        gaps.push({
            kind: 'missing-slot',
            detail: `exhibit slot ${slot} of ${TARGET_CANDIDATE_SLOTS} has no independently documented work`,
        });
    }

    return {
        target: TARGET_CANDIDATE_SLOTS,
        ready,
        remaining,
        complete: ready >= TARGET_CANDIDATE_SLOTS && gaps.length === 0,
        gaps,
    };
}
