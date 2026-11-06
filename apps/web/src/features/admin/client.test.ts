import { afterEach, expect, it, vi } from 'vitest';
import { createAdminHttpClient } from './client';
afterEach(() => vi.unstubAllGlobals());
it('creates an idempotency key when randomUUID is unavailable', async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    vi.stubGlobal('window', { location: { origin: 'http://203.0.113.10' } });
    let key = '';
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
        key = new Headers(init.headers).get('idempotency-key') ?? '';
        return Response.json({ ok: true, value: {} });
    });
    await createAdminHttpClient().call('POST', '/backups', {}, true);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});
it('keeps a key after response loss but starts a new operation after confirmed success', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
    const keys: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
        keys.push(new Headers(init.headers).get('idempotency-key')!);
        if (keys.length === 1) throw new Error('response lost');
        return Response.json({ ok: true, value: { jobId: 'job', state: 'queued' } });
    });
    const client = createAdminHttpClient();
    await expect(client.call('POST', '/backups', { reason: 'same' }, true)).rejects.toThrow('response lost');
    await client.call('POST', '/backups', { reason: 'same' }, true);
    await client.call('POST', '/backups', { reason: 'same' }, true);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
});

it('uses the explicit confirmation key across uncertain responses and a fresh key for a new confirmation', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
    const keys: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
        keys.push(new Headers(init.headers).get('idempotency-key')!);
        if (keys.length === 1) return new Response('invalid response', { status: 502 });
        return Response.json({ ok: true, value: {} });
    });
    const client = createAdminHttpClient(), first = crypto.randomUUID(), second = crypto.randomUUID();
    await expect(client.call('POST', '/backups', { reason: 'same' }, first)).rejects.toThrow();
    await client.call('POST', '/backups', { reason: 'same' }, first);
    await client.call('POST', '/backups', { reason: 'same' }, second);
    expect(keys).toEqual([first, first, second]);
});
it('retains automatic keys for 5xx and malformed replies, completing only validated results', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
    const keys: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
        keys.push(new Headers(init.headers).get('idempotency-key')!);
        if (keys.length === 1) return new Response('bad gateway', { status: 502 });
        if (keys.length === 2) return Response.json({ ok: true, invalid: true });
        return Response.json({ ok: true, value: {} });
    });
    const client = createAdminHttpClient();
    for (let i = 0; i < 2; i++) await expect(client.call('POST', '/backups', {}, true)).rejects.toThrow();
    await client.call('POST', '/backups', {}, true);
    await client.call('POST', '/backups', {}, true);
    expect(keys[0]).toBe(keys[1]); expect(keys[1]).toBe(keys[2]); expect(keys[3]).not.toBe(keys[2]);
});
