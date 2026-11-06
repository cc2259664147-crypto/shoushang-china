import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TemplateVersionSchema, WorkSchema, type CutOperation, type PapercutState, type TemplateVersion, type Work } from '@shoushang/contracts';
import { createPapercutCore, getWorkGeometry, HISTORY_LIMIT } from '@shoushang/papercut-core';
import { createArtworkRenderer } from '@shoushang/artwork-renderer';
import { candidateTemplates } from './template-candidates';

const core = createPapercutCore();
const renderer = createArtworkRenderer();
const evidence = process.env.M14_3B_EVIDENCE;
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const initialWork = (template: TemplateVersion): Work => WorkSchema.parse({
  id: `m14-3b-work-${template.id}`, name: `隔离候选 ${template.id}`, craftId: template.craftId, templateSnapshot: template,
  palette: { paper: template.recommendedColors[0], background: '#FFFFEE' }, operations: [], status: 'draft', schemaVersion: 1, revision: 0,
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
});
const op = (template: TemplateVersion, order: number, shape: CutOperation['shape'], x: number, y: number, width: number, height: number, angleDeg = 0): CutOperation => ({
  id: `${template.id}-cut-${order}`, order, parameterVersion: 1, shape, center: { x, y }, width, height, angleDeg,
});
const add = (state: PapercutState, operation: CutOperation) => unwrap(core.dispatch(state, { type: 'add-cut', operation }));
const region = (template: TemplateVersion) => template.geometry.allowedRegion;
const bounds = (template: TemplateVersion) => ({ left: Math.min(...region(template).map(p => p.x)), right: Math.max(...region(template).map(p => p.x)), top: Math.min(...region(template).map(p => p.y)), bottom: Math.max(...region(template).map(p => p.y)) });

describe('M14-3B isolated candidate templates via public core and renderer', () => {
  for (const template of candidateTemplates) {
    it(`${template.id}: schema, legal shapes/rotation, boundaries, history, palette and SVG`, () => {
      expect(TemplateVersionSchema.safeParse(template).success).toBe(true);
      const empty = initialWork(template);
      let state: PapercutState = unwrap(core.createState(empty));
      expect(state.work.operations).toHaveLength(0);
      const b = bounds(template), cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
      const oldCenter = op(template, 0, template.allowedCuts[0]!.shape, .25, .5, .1, .1);
      if (template.id === 'template-dev-c03') {
        const wrong = core.dispatch(state, { type: 'add-cut', operation: oldCenter });
        expect(wrong.ok).toBe(false);
        if (!wrong.ok) expect(wrong.error.code).toBe('GEOMETRY_INVALID');
      }
      for (const [index, limit] of template.allowedCuts.entries()) {
        const width = limit.minWidth + (limit.maxWidth - limit.minWidth) / 3;
        const height = limit.minHeight + (limit.maxHeight - limit.minHeight) / 3;
        state = add(state, op(template, index, limit.shape, cx + index * .025, cy + index * .025, width, height, 17));
      }
      const good = state;
      const invalid = [
        op(template, good.work.operations.length, template.allowedCuts[0]!.shape, b.left - .05, cy, .05, .05),
        op(template, good.work.operations.length, template.allowedCuts[0]!.shape, b.right + .05, cy, .05, .05),
        op(template, good.work.operations.length, template.allowedCuts[0]!.shape, cx, b.top - .05, .05, .05),
        op(template, good.work.operations.length, template.allowedCuts[0]!.shape, cx, b.bottom + .05, .05, .05),
        op(template, good.work.operations.length, template.allowedCuts[0]!.shape, cx, cy, template.allowedCuts[0]!.maxWidth + .01, .05),
        op(template, good.work.operations.length, template.allowedCuts[0]!.shape, cx, cy, template.allowedCuts[0]!.minWidth - .005, .05),
      ];
      for (const operation of invalid) {
        expect(core.dispatch(good, { type: 'add-cut', operation }).ok).toBe(false);
        expect(state).toEqual(good);
      }
      for (const limit of template.allowedCuts) {
        expect(core.validate({ ...empty, operations: [op(template, 0, limit.shape, cx, cy, limit.minWidth, limit.minHeight)] }).ok).toBe(true);
        expect(core.validate({ ...empty, operations: [op(template, 0, limit.shape, cx, cy, limit.maxWidth, limit.maxHeight)] }).ok).toBe(true);
      }
      const recolored = unwrap(core.dispatch(state, { type: 'set-palette', palette: { paper: '#276B62', background: '#FFFFEE' } }));
      expect(recolored.work.operations).toEqual(state.work.operations);
      const undone = unwrap(core.dispatch(recolored, { type: 'undo' }));
      const redone = unwrap(core.dispatch(undone, { type: 'redo' }));
      expect(redone.work.palette.paper).toBe('#276B62');
      const branched = add(undone, op(template, undone.work.operations.length, template.allowedCuts[0]!.shape, cx, cy, .05, .05));
      expect(branched.redo).toHaveLength(0);
      const geometry = unwrap(getWorkGeometry(redone.work));
      expect(geometry.cuts).toHaveLength(template.allowedCuts.length);
      expect(geometry.symmetryTransforms).toHaveLength(template.geometry.symmetry.kind === 'radial' ? 4 : 2);
      const folded = unwrap(renderer.render({ work: redone.work, width: 480, height: 480, view: 'folded' }));
      const expanded = unwrap(renderer.render({ work: redone.work, width: 480, height: 480, view: 'unfolded' }));
      expect(folded.svg).not.toBe(expanded.svg);
      expect(expanded.svg).toContain('data:image/svg+xml');
      if (evidence) {
        mkdirSync(evidence, { recursive: true });
        writeFileSync(join(evidence, `${template.id}-work.json`), JSON.stringify(redone.work, null, 2));
        writeFileSync(join(evidence, `${template.id}-folded.svg`), folded.svg);
        writeFileSync(join(evidence, `${template.id}-unfolded.svg`), expanded.svg);
      }
    });

    it(`${template.id}: genuine sequential operations reach ${template.rules.maxOperations}, history stays at 30`, () => {
      let state: PapercutState = unwrap(core.createState(initialWork(template)));
      const b = bounds(template), max = template.rules.maxOperations, limit = template.allowedCuts[0]!;
      const width = limit.minWidth, height = limit.minHeight;
      for (let i = 0; i < max; i++) {
        const col = i % 10, row = Math.floor(i / 10);
        const x = b.left + .04 + col * ((b.right - b.left - .08) / 9);
        const y = b.top + .04 + row * ((b.bottom - b.top - .08) / Math.max(1, Math.ceil(max / 10) - 1));
        state = add(state, op(template, i, limit.shape, x, y, width, height));
      }
      expect(state.work.operations).toHaveLength(max);
      expect(state.undo).toHaveLength(Math.min(max, HISTORY_LIMIT));
      const extra = core.dispatch(state, { type: 'add-cut', operation: op(template, max, limit.shape, (b.left + b.right) / 2, (b.top + b.bottom) / 2, width, height) });
      expect(extra.ok).toBe(false);
      expect(state.work.operations).toHaveLength(max);
      const afterUndo = unwrap(core.dispatch(state, { type: 'undo' }));
      expect(afterUndo.work.operations).toHaveLength(max - 1);
      expect(unwrap(core.dispatch(afterUndo, { type: 'redo' })).work.operations).toHaveLength(max);
    }, 90000);
  }
});
