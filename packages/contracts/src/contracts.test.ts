import { describe, expect, it } from 'vitest';
import { CraftSchema, CutOperationSchema, ExhibitSchema, FavoriteSchema, HealthSchema, MediaSchema, ContentQuerySchema, StorySchema, TemplateVersionSchema, WorkSchema, ApiErrorSchema } from './index';
import { crafts, createFixtureWork, exhibits, fixtureTime, stories, templates } from '@shoushang/fixtures';

describe('public contracts', () => {
  it('accepts all deterministic entity fixtures', () => {
    expect(CraftSchema.safeParse(crafts[0]).success).toBe(true);
    expect(TemplateVersionSchema.safeParse(templates[0]).success).toBe(true);
    expect(ExhibitSchema.safeParse(exhibits[0]).success).toBe(true);
    expect(StorySchema.safeParse(stories[0]).success).toBe(true);
    expect(MediaSchema.safeParse(exhibits[0]?.media[0]).success).toBe(true);
    expect(WorkSchema.safeParse(createFixtureWork()).success).toBe(true);
    expect(FavoriteSchema.safeParse({ exhibitId: 'exhibit-dev-paper', createdAt: fixtureTime }).success).toBe(true);
  });
  it('validates coordinate, size, angle, order and parameter version', () => {
    const operation = { id: 'cut-1', shape: 'triangle', center: { x: 0.2, y: 0.4 }, width: 0.1, height: 0.1, angleDeg: 90, order: 0, parameterVersion: 1 };
    expect(CutOperationSchema.safeParse(operation).success).toBe(true);
    for (const change of [{ center: { x: 1.1, y: 0 } }, { width: 0 }, { height: 2 }, { angleDeg: 360 }, { order: -1 }, { parameterVersion: 2 }, { shape: 'script' }]) {
      expect(CutOperationSchema.safeParse({ ...operation, ...change }).success).toBe(false);
    }
  });
  it('rejects incompatible and malformed works and admin fields', () => {
    const work = createFixtureWork();
    for (const change of [{ schemaVersion: 2 }, { revision: -1 }, { createdAt: 'yesterday' }, { updatedAt: '2020-01-01T00:00:00Z' }, { name: ' ' }, { name: '名'.repeat(31) }, { templateSnapshot: undefined }, { craftId: 'different' }]) {
      expect(WorkSchema.safeParse({ ...work, ...change }).success).toBe(false);
    }
    expect(ExhibitSchema.safeParse({ ...exhibits[0], passwordHash: 'hidden' }).success).toBe(false);
    expect(MediaSchema.safeParse({ ...exhibits[0]?.media[0], proofRef: '/private/proof' }).success).toBe(false);
    expect(MediaSchema.safeParse({ ...exhibits[0]?.media[0], url: 'javascript:alert(1)' }).success).toBe(false);
  });
  it('normalizes search and refuses invalid pagination or oversized keyword', () => {
    expect(ContentQuerySchema.parse({ q: '  PAPER  ' })).toEqual({ q: 'paper', page: 1, pageSize: 12 });
    for (const query of [{ page: 0 }, { pageSize: 51 }, { page: 1.5 }, { q: 'a'.repeat(101) }]) expect(ContentQuerySchema.safeParse(query).success).toBe(false);
  });
  it('validates common health and error envelopes', () => {
    expect(HealthSchema.safeParse({ status: 'ok', service: '@shoushang/api', version: '0.1.0', contentMode: 'mock', database: 'not-initialized' }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: 'FORBIDDEN', message: '无权限', requestId: 'test', fieldErrors: [] }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: 'SUCCESS', message: 'x' }).success).toBe(false);
  });
});
