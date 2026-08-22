import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
process.env.ADMIN_SESSION_SECRET = 'test-admin-session-secret';
const testPasswordSalt = Buffer.from('test-password-salt');
const testPasswordHash = crypto.scryptSync('secret', testPasswordSalt, 64, { N: 16384, r: 8, p: 1 });
process.env.ADMIN_PASSWORD_HASH = `scrypt:${testPasswordSalt.toString('base64url')}:${testPasswordHash.toString('base64url')}`;
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

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4: SSE client disconnect -> log still written
// ═══════════════════════════════════════════════════════════════════════════════

describe('SSE client disconnect logging', () => {
  let ep1, fetchMock;

  beforeEach(() => {
    for (const ep of DB.getAllEndpoints()) DB.deleteEndpoint(ep.id);
    try { DB.getLogs(1, 1); } catch {}
    ep1 = DB.createEndpoint({ name: 'e1', url: 'https://api.sensenova.cn/v1/llm', api_key: 'k1', priority: 0 });
    DB.markHealthy(ep1.id);
    const id1 = ep1.id;
    vi.spyOn(DB, 'getAvailableEndpoints').mockImplementation(() => [DB.getEndpoint(id1)]);
    vi.spyOn(DB, 'getHealthyEndpoints').mockImplementation(() => [DB.getEndpoint(id1)]);
  });

  afterEach(() => { fetchMock?.mockRestore(); vi.restoreAllMocks(); });

  function makeSse(chunks) {
    return { ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      body: new ReadableStream({
        start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); },
      })};
  }

  it('log written when client disconnects (abort response reader)', async () => {
    fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => makeSse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    ]));

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'g4', stream: true }),
    });
    const resp = await PROXY.proxyRequest(req, 'v1/chat/completions');
    expect(resp.status).toBe(200);

    // Simulate client disconnect: abort the response reader without reading everything
    const reader = resp.body.getReader();
    await reader.read();  // read first chunk
    await reader.cancel('client disconnected');

    await new Promise(r => setTimeout(r, 300));

    const logs = DB.getLogs(1, 100).logs;
    expect(logs.length).toBeGreaterThan(0);
    const log = logs.find(l => l.model === 'g4') || logs[0];
    expect(log.error).toBeDefined();
    expect(log.error).toContain('disconnect');
    console.log('  [PASS] log written on client disconnect');
  });

  it('log written when upstream stream throws error', async () => {
    let readerController: ReadableStreamDefaultController<Uint8Array> | null = null;
    fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      body: new ReadableStream({
        start(controller) {
          readerController = controller;
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
        },
      }),
    }));

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'g4', stream: true }),
    });
    const resp = await PROXY.proxyRequest(req, 'v1/chat/completions');
    expect(resp.status).toBe(200);

    // Consume one chunk then force an error on the upstream stream
    const reader = resp.body.getReader();
    await reader.read();

    // Close the upstream abruptly (simulate connection drop)
    readerController?.close();

    await new Promise(r => setTimeout(r, 500));

    const logs = DB.getLogs(1, 100).logs;
    expect(logs.length).toBeGreaterThan(0);
    console.log('  [PASS] log written on upstream stream error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5: Login rate limiting
// ═══════════════════════════════════════════════════════════════════════════════

describe('Login rate limiting', () => {
  let loginHandler, LOGIN_MODULE;

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = 'admin';
    LOGIN_MODULE = await import('../src/app/api/auth/login/route.ts');
    loginHandler = LOGIN_MODULE.POST;
  });

  afterAll(() => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_SESSION_SECRET;
  });

  function loginReq(username, password, ip = '1.2.3.4') {
    return new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ username, password }),
    });
  }

  it('5 failed attempts lock the account for 15 minutes', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      const resp = await loginHandler(loginReq('admin', 'wrong', ip));
      expect(resp.status).toBe(401);
    }
    const locked = await loginHandler(loginReq('admin', 'wrong', ip));
    expect(locked.status).toBe(429);
    const data = await locked.json();
    expect(data.error).toContain('过多');
    console.log('  [PASS] account locked after 5 failures');
  });

  it('correct credentials clear failure counter', async () => {
    const ip = '10.0.0.2';
    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      const resp = await loginHandler(loginReq('admin', 'wrong', ip));
      expect(resp.status).toBe(401);
    }
    // correct credentials should succeed and clear counter
    const resp = await loginHandler(loginReq('admin', 'secret', ip));
    expect(resp.status).toBe(200);
    const cookie = resp.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('sensenova_admin_session');
    // subsequent failure starts counting from 0
    const after = await loginHandler(loginReq('admin', 'wrong', ip));
    expect(after.status).toBe(401);
    console.log('  [PASS] correct login clears counter');
  });

  it('different user not affected by lock', async () => {
    const ip = '10.0.0.3';
    // Lock 'admin'
    for (let i = 0; i < 5; i++) {
      await loginHandler(loginReq('admin', 'wrong', ip));
    }
    const locked = await loginHandler(loginReq('admin', 'wrong', ip));
    expect(locked.status).toBe(429);
    // 'other' user should not be affected
    const resp = await loginHandler(loginReq('other', 'wrong', ip));
    expect(resp.status).toBe(401);
    console.log('  [PASS] different user not affected by lock');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 6: Endpoint test logs with is_test flag
// ═══════════════════════════════════════════════════════════════════════════════

describe('Endpoint test logging with is_test', () => {
  let testHandler, ep1, fetchMock;

  beforeAll(async () => {
    const MOD = await import('../src/app/api/endpoints/[id]/test/route.ts');
    testHandler = MOD.POST;
  });

  beforeEach(() => {
    for (const ep of DB.getAllEndpoints()) DB.deleteEndpoint(ep.id);
    try { DB.getLogs(1, 1); } catch {}
    ep1 = DB.createEndpoint({ name: 'e1', url: 'https://api.sensenova.cn/v1/llm', api_key: 'k1', priority: 0 });
    DB.markHealthy(ep1.id);
  });

  afterEach(() => { fetchMock?.mockRestore(); });

  it('successful test writes log with is_test = 1', async () => {
    fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }),
    }));

    const req = new Request(`http://localhost/api/endpoints/${ep1.id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'g4' }),
    });

    const params = Promise.resolve({ id: ep1.id });
    const resp = await testHandler(req, { params });
    expect(resp.status).toBe(200);

    const logs = DB.getLogs(1, 100).logs;
    expect(logs.length).toBeGreaterThan(0);
    const log = logs.find(l => l.model === 'g4');
    expect(log).toBeDefined();
    expect(log.is_test).toBe(1);
    expect(log.prompt_tokens).toBe(5);
    console.log('  [PASS] test log written with is_test=1');
  });

  it('failed test writes log with is_test = 1', async () => {
    fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: false, status: 500,
      text: async () => 'Internal Server Error',
    }));

    const req = new Request(`http://localhost/api/endpoints/${ep1.id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'g4' }),
    });

    const params = Promise.resolve({ id: ep1.id });
    const resp = await testHandler(req, { params });
    expect(resp.status).toBe(200);

    const logs = DB.getLogs(1, 100).logs;
    const log = logs.find(l => l.model === 'g4');
    expect(log).toBeDefined();
    expect(log.is_test).toBe(1);
    expect(log.success).toBe(false);
    console.log('  [PASS] failed test log written with is_test=1');
  });

  it('usage stats exclude is_test logs', async () => {
    // Write a test log
    await DB.addLog({ endpoint_id: ep1.id, endpoint_name: 'e1', method: 'POST', path: 'chat/completions', status: 200, duration: 100, success: true, switched: false, model: 'g4', stream: false, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, is_test: true });

    // Write a real log
    await DB.addLog({ endpoint_id: ep1.id, endpoint_name: 'e1', method: 'POST', path: 'chat/completions', status: 200, duration: 200, success: true, switched: false, model: 'g4', stream: false, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });

    const stats = DB.getUsageStats();
    expect(stats.total_requests).toBe(1); // only the real log
    expect(stats.by_model[0].prompt_tokens).toBe(10);
    console.log('  [PASS] stats exclude is_test logs');
  });
});
