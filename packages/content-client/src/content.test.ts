import { describe, expect, it } from 'vitest';
import { createMockContentClient } from './index';

describe('deterministic mock content adapter', () => {
  it('queries all content through the shared interface and clones returned data', async () => {
    const client = createMockContentClient();
    expect((await client.listCrafts()).ok).toBe(true);
    expect((await client.listTemplates()).ok).toBe(true);
    expect((await client.getTemplate('template-dev-square')).ok).toBe(true);
    expect((await client.listStories()).ok).toBe(true);
    expect((await client.getStory('story-dev-process')).ok).toBe(true);
    expect((await client.getHome()).ok).toBe(true);
    const result = await client.listExhibits({ q: '  几何  ', craftId: 'craft-papercut', category: '开发示意', tag: '占位' });
    expect(result.ok && result.value.total).toBe(1);
    if (result.ok && result.value.items[0]) result.value.items[0].title = 'mutated';
    const detail = await client.getExhibit('exhibit-dev-paper');
    expect(detail.ok && detail.value.title).toBe('开发占位：几何纸样');
  });
  it('supports explicit empty, missing, failure, invalid query and filter intersection', async () => {
    const empty = await createMockContentClient('empty').listExhibits();
    expect(empty.ok && empty.value.total).toBe(0);
    const missing = await createMockContentClient().getExhibit('missing');
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    const failure = await createMockContentClient('failure').getHome();
    expect(!failure.ok && failure.error.code).toBe('NETWORK_ERROR');
    const invalid = await createMockContentClient().listStories({ pageSize: 99 });
    expect(!invalid.ok && invalid.error.code).toBe('INVALID_INPUT');
    const excluded = await createMockContentClient().listExhibits({ q: '几何', category: '不存在' });
    expect(excluded.ok && excluded.value.total).toBe(0);
    const page2 = await createMockContentClient().listExhibits({ page: 2 });
    expect(page2.ok && page2.value.items).toEqual([]);
  });
});
