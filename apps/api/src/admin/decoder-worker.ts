import sharp from 'sharp';
// This worker accepts bounded binary input only; no user paths, URLs or image options.
sharp.cache(false);
sharp.concurrency(1);
const max = 5 * 1024 * 1024;
let size = 0;
const chunks: Buffer[] = [];
process.stdin.on('data', (chunk: Buffer) => { size += chunk.length; if (size > max) {
    process.exitCode = 1;
    process.stdin.destroy();
}
else
    chunks.push(chunk); });
process.stdin.on('end', () => { void decode().catch(() => { process.stderr.write('IMAGE_REJECTED'); process.exitCode = 1; }); });
async function decode() {
    if (!size || size > max)
        throw new Error('invalid');
    const bytes = Buffer.concat(chunks);
    // Sharp supports more formats: magic allowlist prevents ever invoking SVG/PDF decoders.
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !webp)
        throw new Error('invalid');
    const opts = { failOn: 'warning' as const, limitInputPixels: 36000000, sequentialRead: true };
    const meta = await sharp(bytes, opts).metadata();
    if (!meta.width || !meta.height || meta.width > 6000 || meta.height > 6000 || (meta.pages ?? 1) !== 1 || !['jpeg', 'png', 'webp'].includes(meta.format ?? ''))
        throw new Error('invalid');
    const original = await sharp(bytes, opts).rotate().png().toBuffer({ resolveWithObject: true });
    const thumb = await sharp(original.data, opts).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (original.data.length > 64 * 1024 * 1024 || thumb.length > 2 * 1024 * 1024)
        throw new Error('invalid');
    const header = Buffer.from(JSON.stringify({ format: meta.format, width: original.info.width, height: original.info.height, originalSize: original.data.length, thumbnailSize: thumb.length }) + '\n');
    process.stdout.write(header);
    process.stdout.write(original.data);
    process.stdout.write(thumb);
}
