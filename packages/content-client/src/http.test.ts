import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEventListeners, once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crafts, exhibits } from '@shoushang/fixtures';
import { createHttpContentClient, createMockContentClient } from './index';
import type { ContentClient } from '@shoushang/contracts';
// Read-only integration with the existing application logic, requested by the M12 review.
import { WorkshopSession } from '../../../apps/web/src/features/workshop/session';

afterEach(() => vi.unstubAllGlobals());

function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); }
function error(code: string) { return { ok: false, error: { code, message: '测试故障', requestId: 'test-request-id', fieldErrors: [] } }; }
async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void, test: (url: string) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  try { await test(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>((done, reject) => server.close(e => e ? reject(e) : done())); }
}
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  // Request IDs and server write timestamps belong to each implementation; source dates compare as instants.
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt' && key !== 'requestId').map(([k, v]) => [k, k === 'accessedAt' && typeof v === 'string' ? Date.parse(v) : normalized(v)]));
  return value;
}

describe('HTTP ContentClient over actual loopback sockets', () => {
  it('creates local request IDs when randomUUID is unavailable', async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    const result = await createHttpContentClient().getExhibit('bad/id');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.requestId).toMatch(/^http-client-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it('feeds actual developmentData through SQLite and HTTP into the unchanged workshop session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shoushang-m12-development-workshop-'));
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('apps/api/src/content/test-server.ts'), '--m12-development-server', join(dir, 'development.sqlite')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => { stderr += String(data); });
    let session: WorkshopSession | undefined;
    try {
      const address = await new Promise<string>((done, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`Development API readiness timeout: ${stderr}`)), 10000);
        child.once('error', e => { clearTimeout(timer); reject(e); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Development API exited ${code}: ${stderr}`)); });
        child.stdout.on('data', data => {
          output += String(data);
          if (!output.includes('\n')) return;
          try {
            const parsed: unknown = JSON.parse(output.split('\n')[0] ?? '');
            if (typeof parsed !== 'object' || parsed === null || !('address' in parsed) || typeof parsed.address !== 'string') throw new Error('Invalid readiness');
            clearTimeout(timer); done(parsed.address);
          } catch (e) { clearTimeout(timer); reject(e); }
        });
      });
      const http = createHttpContentClient({ baseUrl: address });
      const all = await http.listTemplates();
      expect(all.ok && all.value.total).toBe(2);
      const filtered = await http.listTemplates({ craftId: 'craft-papercut', pageSize: 50 });
      expect(filtered.ok && filtered.value.total).toBe(2);
      if (!filtered.ok) throw new Error('template list unavailable');
      expect(filtered.value.items.find(item => item.id === 'template-v2-c04')?.allowedCuts.map(limit => limit.shape)).toEqual([
        'circle', 'triangle', 'teardrop', 'ellipse', 'rectangle', 'star', 'petal',
      ]);
      // Do not open visitor IndexedDB. Storage is deliberately unavailable; actual content/core logic runs.
      session = new WorkshopSession(http, async () => ({ ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: '隔离测试不访问访客存储', requestId: 'development-workshop-test', fieldErrors: [] } }));
      await session.start();
      expect(session.snapshot().templateError).toBe('');
      expect(session.snapshot().templates).toHaveLength(1);
      const template = session.snapshot().templates[0];
      if (!template) throw new Error('Initialized development template missing in workshop');
      expect(template.id).toBe('template-dev-paper');
      expect(template.craftId).toBe('craft-papercut');
      expect(template.name).toContain('开发'); expect(template.digitalNotice).toContain('开发');
      expect(session.newWork(template)).toBe(true);
      expect(session.snapshot().error).toBe('');
      expect(session.snapshot().step).toBe('color');
      expect(session.snapshot().state?.work.templateSnapshot).toEqual(template);
      expect(session.snapshot().state?.work.craftId).toBe('craft-papercut');
    } finally {
      session?.dispose();
      const exited = child.exitCode !== null ? Promise.resolve() : once(child, 'exit');
      child.stdin.end(); await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
  it('uses the real API/SQLite in another process and agrees with mock on common legal data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shoushang-m12-http-'));
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('apps/api/src/content/test-server.ts'), '--m12-test-server', join(dir, 'http.sqlite')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => { stderr += String(data); });
    try {
      const address = await new Promise<string>((done, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`Test API readiness timeout: ${stderr}`)), 10000);
        child.once('error', e => { clearTimeout(timer); reject(e); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test API exited ${code}: ${stderr}`)); });
        child.stdout.on('data', data => {
          output += String(data);
          if (output.includes('\n')) {
            try { const parsed: unknown = JSON.parse(output.split('\n')[0] ?? '');
              if (typeof parsed === 'object' && parsed !== null && 'address' in parsed && typeof parsed.address === 'string') { clearTimeout(timer); done(parsed.address); }
              else { clearTimeout(timer); reject(new Error('Invalid readiness')); }
            } catch (e) { clearTimeout(timer); reject(e); }
          }
        });
      });
      const http = createHttpContentClient({ baseUrl: address }), mock = createMockContentClient();
      expect(http.mode).toBe('http');
      const cases: ((client: ContentClient) => Promise<unknown>)[] = [
        c => c.listCrafts(), c => c.getTemplate('template-dev-square'),
        c => c.listExhibits({ q: '  几何  ', craftId: 'craft-papercut', category: '开发示意', tag: '占位' }),
        c => c.listExhibits({ page: 2 }), c => c.getExhibit('exhibit-dev-paper'), c => c.getExhibit('missing'),
        c => c.listStories({ craftId: 'craft-papercut' }), c => c.getStory('story-dev-process'), c => c.getHome(),
      ];
      for (const invoke of cases) expect(normalized(await invoke(http))).toEqual(normalized(await invoke(mock)));
      const official = await http.getTemplate('template-v2-c04');
      expect(official.ok && official.value.name).toBe('自由造型：花形与几何');
      const [old, fresh] = await Promise.all([http.listExhibits({ q: 'missing' }), http.listExhibits({ q: '几何' })]);
      expect(old.ok && old.value.total).toBe(0); expect(fresh.ok && fresh.value.total).toBe(1);
    } finally {
      const exited = child.exitCode !== null ? Promise.resolve() : once(child, 'exit');
      child.stdin.end(); await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
  it('encodes filters and IDs, joins deployment prefixes, validates input before any network request', async () => {
    const urls: string[] = [];
    await serve((req, res) => { urls.push(req.url ?? ''); json(res, 200, { ok: true, value: { items: [], total: 0, page: 1, pageSize: 12 } }); }, async baseUrl => {
      const c = createHttpContentClient({ baseUrl: `${baseUrl}/prefix///` });
      expect((await c.listExhibits({ q: '  A&B + %_中文  ' })).ok).toBe(true);
      const url = new URL(urls[0] ?? '', baseUrl);
      expect(url.pathname).toBe('/prefix/api/v1/exhibits'); expect(url.searchParams.get('q')).toBe('a&b + %_中文');
      for (const q of [{ page: 0 }, { page: Number.MAX_SAFE_INTEGER + 1 }, { q: 'x'.repeat(101) }, { pageSize: 51 }]) {
        const r = await c.listExhibits(q); expect(!r.ok && r.error.code).toBe('INVALID_INPUT');
      }
      const r = await c.getExhibit('bad/id'); expect(!r.ok && r.error.code).toBe('INVALID_INPUT');
      expect(await Reflect.apply(c.getExhibit, c, [undefined])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await Reflect.apply(c.listExhibits, c, [null])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(urls).toHaveLength(1);
    });
    expect(() => createHttpContentClient({ baseUrl: 'ftp://example.org' })).toThrow();
    expect(() => createHttpContentClient({ timeoutMs: 10001 })).toThrow();
  });
  it.each([[404, 'NOT_FOUND'], [403, 'FORBIDDEN'], [500, 'INTERNAL_ERROR'], [400, 'INVALID_INPUT']] as const)('maps HTTP %s without retry', async (status, code) => {
    let calls = 0;
    await serve((_req, res) => { calls++; json(res, status, error(code)); }, async baseUrl => {
      const r = await createHttpContentClient({ baseUrl }).getExhibit('missing');
      expect(!r.ok && r.error.code).toBe(code); expect(!r.ok && r.error.requestId).toBe('test-request-id'); expect(calls).toBe(1);
    });
  });
  it.each([
    [200, '{broken', 'application/json'],
    [200, JSON.stringify({ ok: true, value: [] }), 'text/html'],
    [200, JSON.stringify({ ok: true, value: [{ ...crafts[0], proofRef: 'secret' }] }), 'application/json'],
    [200, JSON.stringify(error('NOT_FOUND')), 'application/json'],
    [404, JSON.stringify({ ok: true, value: [] }), 'application/json'],
    [403, JSON.stringify(error('NOT_FOUND')), 'application/json'],
    [500, JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }), 'application/json'],
    [204, '', 'application/json'],
    [302, JSON.stringify({ ok: true, value: [] }), 'application/json'],
  ])('rejects malformed body/schema/status conflict %s, no retry', async (status, body, contentType) => {
    let calls = 0;
    await serve((_req, res) => { calls++; res.writeHead(status, { 'content-type': contentType }); res.end(body); }, async baseUrl => {
      const r = await createHttpContentClient({ baseUrl }).listCrafts(); expect(!r.ok && r.error.code).toBe('NETWORK_ERROR'); expect(calls).toBe(1);
    });
  });
  it('rejects wrong detail ID and wrong pagination without fake empty success', async () => {
    await serve((req, res) => json(res, 200, { ok: true, value: req.url?.includes('/missing') ? exhibits[0] : { items: [], total: 0, page: 2, pageSize: 12 } }), async baseUrl => {
      const c = createHttpContentClient({ baseUrl });
      for (const r of [await c.getExhibit('missing'), await c.listExhibits()]) expect(!r.ok && r.error.code).toBe('NETWORK_ERROR');
    });
  });
  it('retries only one valid temporary 503 and recovers; caps persistent 502 at two attempts', async () => {
    for (const recover of [true, false]) {
      let calls = 0;
      await serve((_req, res) => { calls++; if (recover && calls === 2) json(res, 200, { ok: true, value: [] }); else json(res, recover ? 503 : 502, error('INTERNAL_ERROR')); }, async baseUrl => {
        const r = await createHttpContentClient({ baseUrl }).listCrafts(); expect(r.ok).toBe(recover); expect(calls).toBe(2);
      });
    }
  });
  it('caps transport retries, handles body interruption and a refused connection', async () => {
    let calls = 0;
    let closedAddress = '';
    await serve((req, _res) => { calls++; req.socket.destroy(); }, async baseUrl => {
      closedAddress = baseUrl;
      const r = await createHttpContentClient({ baseUrl }).listCrafts(); expect(!r.ok && r.error.code).toBe('NETWORK_ERROR'); expect(calls).toBe(2);
    });
    const r = await createHttpContentClient({ baseUrl: closedAddress }).getHome(); expect(!r.ok && r.error.code).toBe('NETWORK_ERROR');
    calls = 0;
    await serve((_req, res) => { calls++; res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); setTimeout(() => res.destroy(), 5); }, async baseUrl => {
      const result = await createHttpContentClient({ baseUrl }).getHome(); expect(!result.ok && result.error.code).toBe('NETWORK_ERROR'); expect(calls).toBe(2);
    });
  });
  it('keeps the default ten-second deadline through stalled body reading (no timeout retry)', async () => {
    let calls = 0;
    await serve((_req, res) => { calls++; res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); }, async baseUrl => {
      const start = performance.now(); const r = await createHttpContentClient({ baseUrl }).getHome();
      expect(!r.ok && r.error.code).toBe('TIMEOUT'); expect(performance.now() - start).toBeGreaterThanOrEqual(9900); expect(performance.now() - start).toBeLessThan(12000); expect(calls).toBe(1);
    });
  }, 15000);
  it('bounds retry by the same total deadline, including header wait', async () => {
    let calls = 0;
    await serve((_req, res) => { calls++; if (calls === 1) json(res, 503, error('INTERNAL_ERROR')); }, async baseUrl => {
      const start = performance.now(); const r = await createHttpContentClient({ baseUrl, timeoutMs: 80 }).getHome();
      expect(!r.ok && r.error.code).toBe('TIMEOUT'); expect(calls).toBe(2); expect(performance.now() - start).toBeLessThan(500);
    });
  });
  it('supports explicit instance lifetime cancellation, cleans listeners, and isolates other clients', async () => {
    let calls = 0;
    await serve((_req, res) => { calls++; if (calls > 1) json(res, 200, { ok: true, value: [] }); }, async baseUrl => {
      const lifetime = new AbortController();
      const c = createHttpContentClient({ baseUrl, signal: lifetime.signal });
      const pending = c.getHome(); setTimeout(() => lifetime.abort(), 30);
      const r = await pending; expect(!r.ok && r.error.code).toBe('ABORTED'); expect(calls).toBe(1);
      expect(getEventListeners(lifetime.signal, 'abort')).toHaveLength(0);
      const preAborted = await c.listCrafts(); expect(!preAborted.ok && preAborted.error.code).toBe('ABORTED'); expect(calls).toBe(1);
      expect((await createHttpContentClient({ baseUrl }).listCrafts()).ok).toBe(true);
    });
    await serve((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); }, async baseUrl => {
      const lifetime = new AbortController(); const pending = createHttpContentClient({ baseUrl, signal: lifetime.signal }).getHome();
      setTimeout(() => lifetime.abort(), 20); const r = await pending; expect(!r.ok && r.error.code).toBe('ABORTED');
      expect(getEventListeners(lifetime.signal, 'abort')).toHaveLength(0);
    });
  });
  it('keeps late calls independent and removes lifetime listeners on success and failure', async () => {
    await serve((req, res) => {
      const q = new URL(req.url ?? '', 'http://local').searchParams.get('q');
      const send = () => json(res, 200, { ok: true, value: { items: q === 'late' ? exhibits : [], total: q === 'late' ? 1 : 0, page: 1, pageSize: 12 } });
      if (q === 'late') setTimeout(send, 40); else send();
    }, async baseUrl => {
      const lifetime = new AbortController(); const c = createHttpContentClient({ baseUrl, signal: lifetime.signal });
      const late = c.listExhibits({ q: 'late' });
      const recent = await c.listExhibits({ q: 'recent' });
      expect(recent.ok && recent.value.total).toBe(0);
      const old = await late; expect(old.ok && old.value.total).toBe(1);
      expect(recent.ok && recent.value.items).toEqual([]);
      expect(getEventListeners(lifetime.signal, 'abort')).toHaveLength(0);
      lifetime.abort(); expect(recent.ok).toBe(true);
    });
  });
});
