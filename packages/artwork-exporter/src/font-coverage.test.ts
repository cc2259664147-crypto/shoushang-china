import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unsupportedCardCharacters } from './index';
import { cardFonts } from './fonts/card-fonts';

describe('bundled card font distribution', () => {
  it('retains the entire original cmap with disjoint, intact local resources', () => {
    const base = new URL('./fonts/', import.meta.url);
    const record = JSON.parse(readFileSync(new URL('generation.json', base), 'utf8')) as {
      sourceSha256: string; licenseSha256: string; sourceCodepoints: number;
      variations: { selector: number; base: number }[];
      shards: { file: string; bytes: number; sha256: string; codepoints: number[] }[];
    };
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(hash(readFileSync(new URL('NotoSansSC-Regular.otf', base)))).toBe(record.sourceSha256);
    expect(hash(readFileSync(new URL('OFL.txt', base)))).toBe(record.licenseSha256);
    expect(record.sourceCodepoints).toBe(30892);
    expect(cardFonts).toHaveLength(record.shards.length);
    const all = record.shards.flatMap(shard => shard.codepoints);
    expect(new Set(all).size).toBe(record.sourceCodepoints);
    expect(all.length).toBe(record.sourceCodepoints);
    expect(unsupportedCardCharacters(String.fromCodePoint(...all))).toEqual([]);
    expect(unsupportedCardCharacters('😀')).toEqual(['😀']);
    expect(unsupportedCardCharacters('𠀋𠮷')).toEqual(['𠀋', '𠮷']);
    expect(record.variations).toHaveLength(25);
    for (const { selector, base } of record.variations) expect(unsupportedCardCharacters(String.fromCodePoint(base, selector))).toEqual([]);
    expect(unsupportedCardCharacters('一\uFE01')).toEqual(['\uFE01']);
    for (const shard of record.shards) {
      const bytes = readFileSync(new URL('../../../' + shard.file, import.meta.url));
      expect(bytes.length, shard.file).toBe(shard.bytes);
      expect(hash(bytes), shard.file).toBe(shard.sha256);
      expect(bytes.subarray(0, 4).toString()).toBe('wOFF');
    }
  });
});
