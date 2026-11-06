import { describe, expect, it } from 'vitest';
import { createFixtureWork } from '@shoushang/fixtures';
import type { CutOperation, Work } from '@shoushang/contracts';
import { createArtworkRenderer } from './index';
import v1GoldenWork from '../../../tests/fixtures/m15/v1-work.json';
import v1FoldedSvg from '../../../tests/fixtures/m15/v1-render-folded.svg?raw';
import v1UnfoldedSvg from '../../../tests/fixtures/m15/v1-render-unfolded.svg?raw';

const renderer = createArtworkRenderer();
function work(radial = false): Work {
  const w = createFixtureWork();
  w.templateSnapshot.geometry.allowedRegion = radial
    ? [{x:.5,y:.5},{x:1,y:.5},{x:1,y:1},{x:.5,y:1}]
    : [{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}];
  if (radial) w.templateSnapshot.geometry.symmetry = {kind:'radial',sectors:4,mirror:false};
  return w;
}
function cut(id: string, order: number, shape: CutOperation['shape'] = 'triangle'): CutOperation {
  return { id, order, parameterVersion:1, shape, center:{x:.25,y:.35}, width:.1, height:.12, angleDeg:0 };
}
function svg(w: Work, view: 'folded'|'unfolded' = 'unfolded', width=400, height=400): string {
  const result = renderer.render({work:w,width,height,view});
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value.rendererVersion).toBe(1);
  return result.value.svg;
}
function drawing(outer: string): string {
  const encoded = /href="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(outer)?.[1];
  expect(encoded).toBeTruthy();
  return decodeURIComponent(encoded!);
}
function deepFreeze(value: object): void {
  Object.freeze(value);
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested);
}

describe('artwork renderer', () => {
  it('keeps the M15 v1 folded and unfolded golden SVG byte-for-byte', () => {
    expect(svg(v1GoldenWork as Work, 'folded', 800, 800)).toBe(v1FoldedSvg);
    expect(svg(v1GoldenWork as Work, 'unfolded', 800, 800)).toBe(v1UnfoldedSvg);
  });
  it('renders an empty square and the core vertical base domain at one fixed paper scale', () => {
    const w = work();
    const full = drawing(svg(w, 'unfolded', 500, 300));
    const folded = drawing(svg(w, 'folded', 500, 300));
    expect(full).toContain('translate(100 0) scale(300)');
    expect(full).toContain('width="1" height="1" fill="white"');
    expect(folded).toContain('M 0 0 L 0.5 0 L 0.5 1 L 0 1 Z');
    expect(full).not.toContain('<ellipse');
  });

  it('uses core triangle vertices, non-square ellipse and original cubic teardrop', () => {
    const w = work();
    w.operations = [cut('triangle',0), {...cut('ellipse',1,'circle'),center:{x:.22,y:.6},width:.16,height:.08}, {...cut('drop',2,'teardrop'),center:{x:.35,y:.72}}];
    const output = drawing(svg(w));
    expect(output).toContain('<path d="M 0 -0.06 L -0.05 0.06 L 0.05 0.06 Z"');
    expect(output).toContain('<ellipse cx="0" cy="0" rx="0.08" ry="0.04"/>');
    expect(output).toContain('C -0.06666666666666667 0 -0.06666666666666667 0.06 0 0.06');
    expect(output).toContain('C 0.06666666666666667 0.06 0.06666666666666667 0 0 -0.06');
    expect(output).not.toContain('conservativeContour');
  });

  it('places then reflects and uses only original cuts when folded', () => {
    const w = work(); w.operations = [{...cut('turn',0),angleDeg:90}];
    const full = drawing(svg(w));
    const folded = drawing(svg(w,'folded'));
    expect(full).toContain('matrix(-1 0 0 1 1 0)"><g transform="matrix(6.123233995736766e-17 1 -1 6.123233995736766e-17 0.25 0.35)"');
    expect((full.match(/<path d="M 0 -0.06/g) ?? []).length).toBe(2);
    expect((folded.match(/<path d="M 0 -0.06/g) ?? []).length).toBe(1);
  });

  it('uses all four core radial transforms and its base domain', () => {
    const w = work(true); w.operations = [{...cut('radial',0),center:{x:.7,y:.7}}];
    const full = drawing(svg(w)); const folded = drawing(svg(w,'folded'));
    expect(full).toContain('matrix(0 1 -1 0 1 0)');
    expect(full).toContain('matrix(-1 0 0 -1 1 1)');
    expect(full).toContain('matrix(0 -1 1 0 0 1)');
    expect(folded).toContain('M 0.5 0.5 L 1 0.5 L 1 1 L 0.5 1 Z');
    expect((full.match(/<path d="M 0 -0.06/g) ?? []).length).toBe(4);
  });

  it('is deterministic, read-only, and isolates changed content with the same work id', () => {
    const w = work(); w.operations = [cut('a',0)];
    const before = JSON.stringify(w); deepFreeze(w);
    const first = svg(w); expect(svg(w)).toBe(first);
    expect(JSON.stringify(w)).toBe(before);
    const recolored = structuredClone(w); recolored.palette.paper = '#112233';
    expect(svg(recolored)).not.toBe(first);
    const moved = structuredClone(w); moved.operations[0]!.center.x=.3;
    expect(svg(moved)).not.toBe(first);
    expect(first).toContain('<image x="0" y="0" width="400" height="400" href="data:image/svg+xml;charset=utf-8,');
    expect(first).not.toContain('<mask');
    expect(drawing(first)).toContain('mask="url(#ss-mask)"');
    expect(drawing(first).replace('xmlns="http://www.w3.org/2000/svg"','')).not.toMatch(/<script|onload=|foreignObject|https?:|xlink:href|<image/i);
  });

  it('renders a disabled historical snapshot without a template lookup', () => {
    const w = work(); w.templateSnapshot.enabled=false; w.templateSnapshot.version=12;
    expect(drawing(svg(w))).toContain('fill="#B82025"');
  });

  it('does not interpolate untrusted work or template text into XML', () => {
    const w = work();
    w.name = '<script>alert(1)</script>';
    w.templateSnapshot.name = '<foreignObject/>';
    const output = drawing(svg(w));
    expect(output).not.toContain('<script');
    expect(output).not.toContain('<foreignObject');
  });

  it('rejects enumerable __proto__ input without polluting prototypes', () => {
    const polluted = work() as Work & Record<string, unknown>;
    Object.defineProperty(polluted, '__proto__', { value: { injected: true }, enumerable: true });
    const result = renderer.render({ work: polluted, width: 100, height: 100, view: 'unfolded' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    expect((Object.prototype as { injected?: unknown }).injected).toBeUndefined();
  });

  it.each(['schemaVersion','geometryVersion','rendererVersion','parameterVersion'] as const)('rejects unknown %s', field => {
    const w = work(); w.operations=[cut('a',0)];
    const target: Record<string, unknown> = field === 'schemaVersion' ? w : field === 'parameterVersion' ? w.operations[0]! : w.templateSnapshot;
    target[field]=2;
    const result = renderer.render({work:w,width:100,height:100,view:'unfolded'});
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.code).toBe('UNSUPPORTED_VERSION'); expect(result.error.fieldErrors.length).toBeGreaterThan(0); }
  });

  it('separates structural input, unsupported combinations and invalid geometry', () => {
    const invalid = work(); invalid.operations=[{...cut('bad',0),width:-1}];
    const unsupported = work(); unsupported.templateSnapshot.geometry.basePaper={kind:'circle'};
    const geometry = work(); geometry.operations=[{...cut('out',0),center:{x:.49,y:.4}}];
    for (const [w,code] of [[invalid,'INVALID_INPUT'],[unsupported,'UNSUPPORTED_VERSION'],[geometry,'GEOMETRY_INVALID']] as const) {
      const r=renderer.render({work:w,width:100,height:100,view:'unfolded'});
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.error.code).toBe(code); expect(r.error.requestId).toBeTruthy(); expect(r.error.fieldErrors.length).toBeGreaterThan(0); }
    }
  });

  it.each([0,-1,1.5,NaN,Infinity,undefined])('rejects invalid width %s without throwing', width => {
    const result=renderer.render({work:work(),width,height:100,view:'unfolded'} as Parameters<typeof renderer.render>[0]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fieldErrors[0]?.path).toBe('width');
  });

  it('rejects bad height, view, and missing input', () => {
    const w=work();
    for (const input of [{work:w,width:100,height:0,view:'unfolded'}, {work:w,width:100,height:100,view:'other'}, undefined]) {
      const result=renderer.render(input as Parameters<typeof renderer.render>[0]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.fieldErrors.length).toBeGreaterThan(0);
    }
  });
});
