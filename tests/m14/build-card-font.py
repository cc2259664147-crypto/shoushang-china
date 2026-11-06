r"""Rebuild all bundled card font shards using installed FontTools; no downloads.
Run: C:\python\python.exe tests/m14/build-card-font.py
WOFF uses Python's built-in zlib; no optional Brotli dependency is needed.
"""
from pathlib import Path
import hashlib, json, platform, zlib, argparse
from io import BytesIO
import fontTools
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--verify-shards', help='Rebuild named comma-separated shards in memory and compare bytes; write nothing')
parser.add_argument('--incremental', action='store_true', help='Reuse hash-checked unchanged nominal shards, then verify every glyph and variation')
args = parser.parse_args()
selected = args.verify_shards
selected = set(selected.split(',')) if selected else None
folder = root / 'packages/artwork-exporter/src/fonts'
source = folder / 'NotoSansSC-Regular.otf'
fixed = '工艺：剪纸创作日期草稿 · 作品时间（尚未保存）数字体验创作，不代表实体可剪裁。手上中国0123456789-…'
original = TTFont(source, recalcTimestamp=False)
original_glyphs = original.getGlyphSet()
cmap = original.getBestCmap()
uvs = {selector: pairs for table in original['cmap'].tables if table.format == 14 for selector, pairs in table.uvsDict.items()}
variation_bases = {cp for pairs in uvs.values() for cp, _ in pairs}
base = (set(map(ord, fixed)) | {cp for cp in cmap if cp < 0x400} | variation_bases) & cmap.keys()
groups = {'base': base}
for cp in sorted(cmap.keys() - base):
    groups.setdefault(f'u{cp // 256:04x}', set()).add(cp)
out = folder / 'card-shards'
out.mkdir(exist_ok=True)
manifest, records, union = [], [], set()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
previous = json.loads((folder / 'generation.json').read_text()) if args.incremental else None
if previous:
    assert previous['sourceSha256'] == sha(source)
    assert previous['licenseSha256'] == sha(folder / 'OFL.txt')
previous_shards = {Path(record['file']).stem: record for record in previous['shards']} if previous else {}
for key, codes in groups.items():
    if selected is not None and key not in selected:
        continue
    path = out / (key + '.woff')
    old = previous_shards.get(key)
    if old and old['codepoints'] == sorted(codes) and not any(cp in codes for cp in variation_bases):
        assert sha(path) == old['sha256']
        data = path.read_bytes()
    else:
        font = TTFont(source, recalcTimestamp=False)
        opts = subset.Options()
        opts.name_IDs = ['*']; opts.name_legacy = True; opts.name_languages = ['*']
        sub = subset.Subsetter(options=opts); sub.populate(unicodes=codes | set(uvs)); sub.subset(font)
        for record in font['name'].names:
            replacements = {1: 'Shoushang Card Sans', 2: 'Regular', 3: 'ShoushangCardSans-2.002-' + key,
                            4: 'Shoushang Card Sans Regular', 6: 'ShoushangCardSans-' + key,
                            16: 'Shoushang Card Sans', 17: 'Regular'}
            if record.nameID in replacements:
                record.string = replacements[record.nameID].encode(record.getEncoding())
        if 'CFF ' in font:
            font['CFF '].cff.fontNames = ['ShoushangCardSans-' + key]
            top = font['CFF '].cff.topDictIndex[0]
            top.FamilyName = 'Shoushang Card Sans'; top.FullName = 'Shoushang Card Sans Regular'
        font.flavor = 'woff'
        buffer = BytesIO(); font.save(buffer, reorderTables=False); data = buffer.getvalue()
    if selected is not None:
        assert data == path.read_bytes(), 'non-reproducible: ' + key
    else:
        path.write_bytes(data)
    restored = TTFont(BytesIO(data)); mapped = set(restored.getBestCmap())
    restored_glyphs = restored.getGlyphSet()
    assert mapped == codes, key
    # Check original advances and outlines by original glyph IDs/names.
    for cp in codes:
        a, b = cmap[cp], restored.getBestCmap()[cp]
        assert original['hmtx'][a] == restored['hmtx'][b]
        before = DecomposingRecordingPen(original_glyphs); original_glyphs[a].draw(before)
        after = DecomposingRecordingPen(restored_glyphs); restored_glyphs[b].draw(after)
        assert before.value == after.value, (key, cp)
    expected_uvs = {selector: dict((cp, glyph) for cp, glyph in pairs if cp in codes) for selector, pairs in uvs.items()}
    expected_uvs = {selector: pairs for selector, pairs in expected_uvs.items() if pairs}
    actual_uvs = {selector: dict(pairs) for table in restored['cmap'].tables if table.format == 14 for selector, pairs in table.uvsDict.items()}
    assert expected_uvs.keys() == actual_uvs.keys(), key
    for selector, pairs in expected_uvs.items():
        assert pairs.keys() == actual_uvs[selector].keys(), key
        for cp, glyph in pairs.items():
            mapped_glyph = actual_uvs[selector][cp]
            assert (glyph is None) == (mapped_glyph is None), (selector, cp)
            if glyph is not None:
                before = DecomposingRecordingPen(original_glyphs); original_glyphs[glyph].draw(before)
                after = DecomposingRecordingPen(restored_glyphs); restored_glyphs[mapped_glyph].draw(after)
                assert before.value == after.value
                assert original['hmtx'][glyph] == restored['hmtx'][mapped_glyph]
    union |= mapped
    ranges = ','.join('U+' + format(cp, 'X') for cp in sorted(codes | (set(uvs) if key == 'base' else set())))
    manifest.append("  { key: '%s', url: new URL('./card-shards/%s.woff?no-inline', import.meta.url).href, range: '%s' }," % (key, key, ranges))
    records.append({'file': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size, 'sha256': sha(path), 'codepoints': sorted(codes)})
if selected is not None:
    assert selected == {Path(record['file']).stem for record in records}, 'unknown shard'
    print(json.dumps({'reproducedByteForByte': sorted(selected), 'sha256': {Path(record['file']).name: record['sha256'] for record in records}}))
    raise SystemExit(0)
assert union == cmap.keys()
expected = {Path(record['file']).name for record in records}
for obsolete in out.glob('*.woff'):
    if obsolete.name not in expected:
        obsolete.unlink()  # Only our dedicated generated shard directory.
variation_manifest = '\nexport const cardFontVariations = ' + json.dumps([{'selector': selector, 'bases': [cp for cp, _ in pairs]} for selector, pairs in uvs.items()]) + ' as const;\n'
(folder / 'card-fonts.ts').write_text('// Generated by tests/m14/build-card-font.py; full original cmap, disjoint shards.\nexport const cardFonts = [\n' + '\n'.join(manifest) + '\n] as const;\n' + variation_manifest, encoding='utf8')
(folder / 'generation.json').write_text(json.dumps({'source': source.name, 'sourceSha256': sha(source), 'licenseSha256': sha(folder / 'OFL.txt'), 'sourceVersion': '2.002', 'family': 'Shoushang Card Sans', 'python': platform.python_version(), 'fontTools': fontTools.__version__, 'zlib': zlib.ZLIB_RUNTIME_VERSION, 'format': 'WOFF (lossless zlib)', 'sourceCodepoints': len(cmap), 'coverageAndAdvancesAndOutlinesVerified': True, 'variations': [{'selector': selector, 'base': cp, 'default': glyph is None} for selector, pairs in uvs.items() for cp, glyph in pairs], 'shards': records}, indent=2) + '\n', encoding='utf8')
print(json.dumps({'shards': len(records), 'bytes': sum(r['bytes'] for r in records), 'baseBytes': records[0]['bytes'], 'codepoints': len(union)}))
