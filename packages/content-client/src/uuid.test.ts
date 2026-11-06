import { describe, expect, it } from 'vitest';
import { generateUuid, type UuidCrypto } from './uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('generateUuid', () => {
  it('prefers native randomUUID when it is available', () => {
    const native = '123e4567-e89b-42d3-a456-426614174000';
    let fallbackCalls = 0;
    const getRandomValues = <T extends ArrayBufferView>(array: T): T => { fallbackCalls += 1; return array; };
    expect(generateUuid({ randomUUID: () => native, getRandomValues })).toBe(native);
    expect(fallbackCalls).toBe(0);
  });

  it('falls back to getRandomValues with RFC 4122 version and variant bits', () => {
    const source: UuidCrypto = {
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        if (array instanceof Uint8Array) array.fill(0xff);
        return array;
      },
    };
    const value = generateUuid(source);
    expect(value).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(value).toMatch(UUID_V4);
  });

  it('creates 10000 unique fallback UUIDs', () => {
    const fallback: UuidCrypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
    const values = new Set(Array.from({ length: 10000 }, () => generateUuid(fallback)));
    expect(values.size).toBe(10000);
    for (const value of values) expect(value).toMatch(UUID_V4);
  });
});
