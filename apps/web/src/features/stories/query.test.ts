import { describe, expect, it } from 'vitest';
import { parseStoryQuery, storiesUrl, storyReturn } from './query';
describe('story URL contract', () => {
  it.each(['?page=0', '?page=-1', '?page=1.2', '?page=01', '?page=9007199254740992', '?page=', '?page=1&page=2', '?craftId=bad.id', '?craftId=', '?craftId=a&craftId=b', '?q=unsupported'])('rejects explicit invalid input %s', search => expect(parseStoryQuery(search).ok).toBe(false));
  it('uses 12 per page and preserves exact selected ID', () => expect(parseStoryQuery('?craftId=craft-papercut&page=2')).toEqual({ ok: true, value: { craftId: 'craft-papercut', page: 2, pageSize: 12 } }));
  it('serializes changes with default page omitted', () => expect(storiesUrl({ craftId: 'craft-papercut', page: 1 })).toBe('/stories?craftId=craft-papercut'));
  it.each(['https://evil.invalid/stories', '//evil.invalid/stories', '/stories/abc', '/stories#anything', '/stories?page=0', '/stories?returnTo=https://evil.invalid', '/stories\\evil'])('rejects uncontrolled return %s', input => expect(storyReturn(input)).toBe('/stories'));
  it('allows a validated local list', () => expect(storyReturn('/stories?craftId=craft-papercut&page=2')).toBe('/stories?craftId=craft-papercut&page=2'));
});
