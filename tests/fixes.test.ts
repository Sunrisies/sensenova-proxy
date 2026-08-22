import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
const origCwd = process.cwd();
let testDbPath = '';

function makeJwt(exp) {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64').replace(/=/g, '');
  const b = Buffer.from(JSON.stringify({ exp })).toString('base64').replace(/=/g, '');
  return `${h}.${b}.sig`;
}

let DB, PROXY, QUOTA, CRYPTO;

beforeAll(async () => {
  const tmp = path.join(os.tmpdir(), `sn-root-${Date.now()}`);
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  process.chdir(tmp);
  testDbPath = path.join(tmp, 'data', 'proxy.db');

  CRYPTO = await import('../src/lib/crypto.ts');
  DB = await import('../src/lib/db.ts');
  QUOTA = await import('../src/lib/quota.ts');
  PROXY = await import('../src/lib/proxy.ts');

  const HEALTH = await import('../src/lib/health.ts');
  HEALTH.stopHealthCheck();
  process.on('unhandledRejection', () => {});
});

afterAll(() => {
  process.chdir(origCwd);
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDbPath + s); } catch {}
  try { fs.rmdirSync(path.dirname(testDbPath)); } catch {}
  try { fs.rmdirSync(path.dirname(path.dirname(testDbPath))); } catch {}
});

function wipe() {
  for (const ep of DB.getAllEndpoints()) DB.deleteEndpoint(ep.id);
  try {
    DB.getLogs(1, 1);
    const Database = require('better-sqlite3');
    const raw = new Database(testDbPath);
    raw.prepare('DELETE FROM request_logs').run();
    raw.close();
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1: OAuth refresh concurrent lock
// ═══════════════════════════════════════════════════════════════════════════════

describe('OAuth refresh concurrent lock', () => {
  let ep, oauthCount = 0, fetchMock;

  beforeEach(() => {
    wipe();
    ep = DB.createEndpoint({
      name: 'qep', url: 'https://api.sensenova.cn/v1/llm', api_key: 'kq', priority: 0,
      sensenova_account_id: 'a1',
      console_access_token: CRYPTO.encryptSecret(makeJwt(Math.floor(Date.now()/1000) - 700)),
      console_access_expires_at: Math.floor(Date.now()/1000) - 700,
      console_refresh_token: CRYPTO.encryptSecret('rt1'),
    });
    oauthCount = 0;

    fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/oauth2/token')) {
        oauthCount++;
        return { ok: true, json: async () => ({
          access_token: makeJwt(Math.floor(Date.now()/1000) + 3600),
          refresh_token: 'nrt',
        })};
      }
      if (url.includes('/models'))
        return { ok: true, json: async () => ({ data: [{ id: 'm1' }] }) };
      if (url.includes('usages'))
        return { ok: true, status: 200, json: async () => ({ model_remaining_percent: { m1: 80 } }) };
      return { ok: false, status: 404 };
    });
  });

  afterEach(() => {
    fetchMock?.mockRestore();
    vi.restoreAllMocks();
  });

  it('3 concurrent calls -> exactly 1 OAuth refresh', async () => {
    const t0 = Date.now();
    const results = await Promise.all([
      QUOTA.getEndpointQuota(ep),
      QUOTA.getEndpointQuota(ep),
      QUOTA.getEndpointQuota(ep),
    ]);
    const elapsed = Date.now() - t0;

    expect(oauthCount).toBe(1);
    results.forEach(r => expect(r.authorization).toBe('valid'));
    expect(elapsed).toBeLessThan(10000);
    console.log(`  [PASS] 3 concurrent -> ${oauthCount} refresh, ${elapsed}ms`);
  });

  it('sequential calls within refresh window -> no duplicate refresh', async () => {
    await QUOTA.getEndpointQuota(ep);
    expect(oauthCount).toBe(1);

    // Re-fetch endpoint from DB — the refresh updated console_access_expires_at
    ep = DB.getEndpoint(ep.id)!;
    const now = Math.floor(Date.now()/1000);
    expect(ep.console_access_expires_at).toBeGreaterThan(now + 3000);

    await QUOTA.getEndpointQuota(ep);
    expect(oauthCount).toBe(1);
    console.log('  [PASS] 2 sequential -> 1 refresh (cached)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2: 429 rate limiting cooldown
// ═══════════════════════════════════════════════════════════════════════════════

describe('429 rate limiting cooldown', () => {
  let ep1, ep2, fetchMock;

  beforeEach(() => {
    wipe();
    ep1 = DB.createEndpoint({ name: 'e1', url: 'https://api.sensenova.cn/v1/llm', api_key: 'k1', priority: 0 });
    ep2 = DB.createEndpoint({ name: 'e2', url: 'https://api.sensenova.cn/v1/llm', api_key: 'k2', priority: 1 });
    DB.markHealthy(ep1.id); DB.markHealthy(ep2.id);
  });

  afterEach(() => {
    fetchMock?.mockRestore();
    vi.restoreAllMocks();
  });

  it('markRateLimited sets cooldown', () => {
    const t = Math.floor(Date.now()/1000);
    DB.markRateLimited(ep1.id, 60);
    const after = DB.getEndpoint(ep1.id);
    expect(after.cooldown_until).toBeGreaterThan(t);
    expect(after.cooldown_until).toBeLessThanOrEqual(t + 65);
    console.log(`  [PASS] cooldown=${after.cooldown_until - t}s`);
  });

  it('getAvailableEndpoints excludes cooldown', () => {
    DB.markRateLimited(ep1.id, 60);
    const ids = DB.getAvailableEndpoints().map(e => e.id);
    expect(ids).not.toContain(ep1.id);
    expect(ids).toContain(ep2.id);
    console.log('  [PASS] excludes cooldown');
  });

  it('getHealthyEndpoints excludes cooldown', () => {
    DB.markRateLimited(ep1.id, 60);
    const ids = DB.getHealthyEndpoints().map(e => e.id);
    expect(ids).not.toContain(ep1.id);
    console.log('  [PASS] healthy excludes');
  });

  it('endpoint returns after cooldown expires', async () => {
    DB.markRateLimited(ep1.id, 1);
    await vi.waitUntil(() => {
      return DB.getAvailableEndpoints().map(e => e.id).includes(ep1.id);
    }, 5000);
    expect(DB.getAvailableEndpoints().map(e => e.id)).toContain(ep1.id);
    console.log('  [PASS] ep1 back after cooldown');
  });

  it('proxy 429 -> cooldown + failover', async () => {
    const id1 = ep1.id, id2 = ep2.id;
    const spyAvailable = vi.spyOn(DB, 'getAvailableEndpoints').mockImplementation(() => [DB.getEndpoint(id1), DB.getEndpoint(id2)]);
    const spyHealthy = vi.spyOn(DB, 'getHealthyEndpoints').mockImplementation(() => [DB.getEndpoint(id1), DB.getEndpoint(id2)]);

    let n = 0;
    fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      n++;
      if (n === 1) return { ok: false, status: 429, text: async () => '{}' };
      return { ok: true, status: 200, text: async () => '{}',
        body: new ReadableStream({ start(c) { c.close(); } }) };
    });

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'g4', stream: false }),
    });
    const resp = await PROXY.proxyRequest(req, 'v1/chat/completions');
    expect(resp.status).toBe(200);
    expect(DB.getEndpoint(id1).cooldown_until).toBeGreaterThan(Math.floor(Date.now()/1000));

    spyAvailable.mockRestore();
    spyHealthy.mockRestore();
    fetchMock?.mockRestore();
    console.log(`  [PASS] 429->cooldown, ${n} attempts`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3: SSE last-frame usage capture
// ═══════════════════════════════════════════════════════════════════════════════

describe('SSE last-frame usage capture', () => {
  let ep1, fetchMock;

  beforeEach(() => {
    wipe();
    ep1 = DB.createEndpoint({ name: 'e1', url: 'https://api.sensenova.cn/v1/llm', api_key: 'k1', priority: 0 });
    DB.markHealthy(ep1.id);
    const id1 = ep1.id;
    vi.spyOn(DB, 'getAvailableEndpoints').mockImplementation(() => [DB.getEndpoint(id1)]);
    vi.spyOn(DB, 'getHealthyEndpoints').mockImplementation(() => [DB.getEndpoint(id1)]);
  });

  afterEach(() => {
    fetchMock?.mockRestore();
    vi.restoreAllMocks();
  });

  function makeSse(chunks) {
    return { ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      body: new ReadableStream({
        start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); },
      })};
  }

  async function runSse(chunks, exp) {
    fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => makeSse(chunks));
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'g4', stream: true }),
    });
    const resp = await PROXY.proxyRequest(req, 'v1/chat/completions');
    expect(resp.status).toBe(200);
    const reader = resp.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    await new Promise(r => setTimeout(r, 500));

    const logs = DB.getLogs(1, 100).logs;
    expect(logs.length).toBeGreaterThan(0);
    const log = logs.find(l => l.model === 'g4') || logs[0];
    expect(log.prompt_tokens).toBe(exp.p);
    expect(log.completion_tokens).toBe(exp.c);
    expect(log.total_tokens).toBe(exp.t);
    return log;
  }

  it('final chunk without trailing newline', async () => {
    const log = await runSse([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}',
    ], { p: 10, c: 20, t: 30 });
    console.log(`  [PASS] flush: p=10 c=20 t=30 ttfb=${log.first_byte_ms}ms`);
  });

  it('usage split across chunk boundaries', async () => {
    const log = await runSse([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":15,"completion_tokens":25,"tota',
      'l_tokens":40}}',
    ], { p: 15, c: 25, t: 40 });
    console.log('  [PASS] split: p=15 c=25 t=40');
  });

  it('usage entirely in flush (no newline)', async () => {
    const log = await runSse([
      'data: {"usage":{"prompt_tokens":99,"completion_tokens":199,"total_tokens":298}}',
    ], { p: 99, c: 199, t: 298 });
    console.log('  [PASS] flush-only: p=99 c=199 t=298');
  });
});
