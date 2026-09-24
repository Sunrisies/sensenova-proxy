import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { encryptSecret, decryptSecret } from './crypto';

let pool: mysql.Pool | null = null;
let initPromise: Promise<void> | null = null;

function getPoolOptions(): mysql.PoolOptions {
  const options: mysql.PoolOptions = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'sensenova_proxy',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  };
  if (process.env.MYSQL_SSL === 'true') {
    options.ssl = { rejectUnauthorized: false };
  }
  return options;
}

async function getPool(): Promise<mysql.Pool> {
  if (pool) return pool;
  if (!initPromise) {
    initPromise = initializePool();
  }
  await initPromise;
  return pool!;
}

type DbPool = {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
};

async function getDb(): Promise<DbPool> {
  return (await getPool()) as unknown as DbPool;
}

async function poolQuery(sql: string, values: unknown[] = []): Promise<[Record<string, unknown>[], mysql.ResultSetHeader]> {
  const [rows, fields] = await (await getDb()).query(sql, values);
  return [rows as Record<string, unknown>[], fields as mysql.ResultSetHeader];
}

async function createIndexSafe(p: DbPool, sql: string): Promise<void> {
  try {
    await p.query(sql);
  } catch (e) {
    const err = e as mysql.QueryError;
    if (err.errno !== 1061 && err.errno !== 1062) throw e;
  }
}

async function addColumnSafe(p: DbPool, sql: string): Promise<void> {
  try {
    await p.query(sql);
  } catch (e) {
    const err = e as mysql.QueryError;
    if (err.errno !== 1060) throw e;
  }
}

async function initializePool(): Promise<void> {
  const dbName = process.env.MYSQL_DATABASE || 'sensenova_proxy';
  const adminOptions: mysql.PoolOptions = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
    charset: 'utf8mb4',
  };
  if (process.env.MYSQL_SSL === 'true') {
    adminOptions.ssl = { rejectUnauthorized: false };
  }

  const adminPool = mysql.createPool(adminOptions);
  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (e) {
    console.warn('[DB] CREATE DATABASE warning:', e);
  } finally {
    await adminPool.end();
  }

  pool = mysql.createPool(getPoolOptions());

  const p = pool as unknown as DbPool;

  await p.query(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      url VARCHAR(512) NOT NULL,
      api_key TEXT NOT NULL,
      priority INT DEFAULT 0,
      weight INT DEFAULT 1,
      enabled TINYINT(1) DEFAULT 1,
      healthy TINYINT(1) DEFAULT 1,
      last_check INT DEFAULT 0,
      error_count INT DEFAULT 0,
      cooldown_until INT DEFAULT 0,
      sensenova_account_id VARCHAR(255),
      console_access_token TEXT,
      console_access_expires_at INT,
      console_refresh_token TEXT,
      created_at INT NOT NULL,
      updated_at INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id VARCHAR(36) PRIMARY KEY,
      request_id VARCHAR(36),
      endpoint_id VARCHAR(36) NOT NULL,
      endpoint_name VARCHAR(255) NOT NULL,
      proxy_key_id VARCHAR(36) NULL,
      proxy_key_name VARCHAR(255) NULL,
      endpoint_group VARCHAR(100) NULL,
      method VARCHAR(10) NOT NULL,
      path VARCHAR(1024) NOT NULL,
      status INT NOT NULL,
      duration INT NOT NULL,
      success TINYINT(1) NOT NULL,
      switched TINYINT(1) DEFAULT 0,
      error TEXT,
      model VARCHAR(255),
      stream TINYINT(1) DEFAULT 0,
      client_ip VARCHAR(45),
      first_byte_ms INT,
      prompt_tokens INT,
      completion_tokens INT,
      total_tokens INT,
      token_estimated TINYINT(1) DEFAULT 0,
      cost DOUBLE,
      switch_chain TEXT,
      is_test TINYINT(1) DEFAULT 0,
      created_at INT NOT NULL,
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS request_attempts (
      id VARCHAR(36) PRIMARY KEY,
      request_id VARCHAR(36),
      endpoint_id VARCHAR(36) NOT NULL,
      endpoint_name VARCHAR(255) NOT NULL,
      method VARCHAR(10) NOT NULL,
      path VARCHAR(1024) NOT NULL,
      status INT NOT NULL,
      duration INT NOT NULL,
      success TINYINT(1) NOT NULL,
      error TEXT,
      model VARCHAR(255),
      created_at INT NOT NULL,
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS proxy_keys (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      key_hash CHAR(64) NOT NULL UNIQUE,
      secret_key TEXT,
      key_display VARCHAR(255) DEFAULT '',
      allowed_models TEXT,
      endpoint_group VARCHAR(100) NOT NULL DEFAULT 'default',
      max_concurrent INT NOT NULL DEFAULT 1,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at INT NOT NULL,
      updated_at INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      login_key VARCHAR(512) PRIMARY KEY,
      failures INT NOT NULL DEFAULT 0,
      locked_until INT NOT NULL DEFAULT 0,
      updated_at INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnSafe(p, "ALTER TABLE endpoints ADD COLUMN endpoint_group VARCHAR(100) NOT NULL DEFAULT 'default' AFTER weight");
  await addColumnSafe(p, 'ALTER TABLE request_logs ADD COLUMN token_estimated TINYINT(1) DEFAULT 0 AFTER total_tokens');
  await addColumnSafe(p, 'ALTER TABLE request_logs ADD COLUMN proxy_key_id VARCHAR(36) NULL AFTER endpoint_name');
  await addColumnSafe(p, 'ALTER TABLE request_logs ADD COLUMN proxy_key_name VARCHAR(255) NULL AFTER proxy_key_id');
  await addColumnSafe(p, 'ALTER TABLE request_logs ADD COLUMN endpoint_group VARCHAR(100) NULL AFTER proxy_key_name');
  await addColumnSafe(p, "ALTER TABLE proxy_keys ADD COLUMN secret_key TEXT AFTER key_hash");
  await addColumnSafe(p, "ALTER TABLE proxy_keys ADD COLUMN key_display VARCHAR(255) DEFAULT '' AFTER secret_key");
  await createIndexSafe(p, 'CREATE INDEX idx_request_logs_created_at ON request_logs(created_at DESC)');
  await createIndexSafe(p, 'CREATE INDEX idx_endpoints_priority ON endpoints(priority ASC, weight DESC)');
  await createIndexSafe(p, 'CREATE INDEX idx_request_logs_request_id ON request_logs(request_id)');
  await createIndexSafe(p, 'CREATE INDEX idx_request_attempts_request_id ON request_attempts(request_id)');
}

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  api_key: string;
  priority: number;
  weight: number;
  endpoint_group: string;
  enabled: boolean;
  healthy: boolean;
  last_check: number;
  error_count: number;
  cooldown_until?: number;
  created_at: number;
  updated_at: number;
  sensenova_account_id?: string;
  console_access_token?: string;
  console_access_expires_at?: number;
  console_refresh_token?: string;
}

export interface CreateEndpointInput {
  name: string;
  url: string;
  api_key: string;
  priority?: number;
  weight?: number;
  endpoint_group?: string;
  enabled?: boolean;
  sensenova_account_id?: string;
  console_access_token?: string;
  console_access_expires_at?: number;
  console_refresh_token?: string;
}

export interface UpdateEndpointInput {
  name?: string;
  url?: string;
  api_key?: string;
  priority?: number;
  weight?: number;
  endpoint_group?: string;
  enabled?: boolean;
  sensenova_account_id?: string;
  console_access_token?: string;
  console_access_expires_at?: number;
  console_refresh_token?: string;
}

export interface ProxyKey {
  id: string;
  name: string;
  key_hash: string;
  masked_key_display: string;
  secret_key?: string;
  secret_available: boolean;
  allowed_models: string[];
  endpoint_group: string;
  max_concurrent: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface CreateProxyKeyInput {
  name: string;
  key_hash: string;
  secret?: string;
  allowed_models?: string[];
  endpoint_group?: string;
  max_concurrent?: number;
}

export interface UpdateProxyKeyInput {
  name?: string;
  allowed_models?: string[];
  endpoint_group?: string;
  max_concurrent?: number;
  enabled?: boolean;
}

function redactProxyKey(hash: string): string {
  return `${hash.slice(0, 8)}…`;
}

function formatProxyKeyDisplay(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 18) return `${secret.slice(0, 8)}…${secret.slice(-4)}`;
  return `${secret.slice(0, 12)}…${secret.slice(-6)}`;
}

function normalizeProxyKey(row: Record<string, unknown>, includeSecret = false): ProxyKey {
  let allowed_models: string[] = [];
  try { allowed_models = row.allowed_models ? JSON.parse(String(row.allowed_models)) : []; } catch { /* legacy malformed configuration */ }
  const keyHash = String(row.key_hash);
  let secretKey = '';
  if (includeSecret && row.secret_key) {
    try { secretKey = decryptSecret(String(row.secret_key)); } catch { secretKey = ''; }
  }
  return {
    id: String(row.id),
    name: String(row.name),
    key_hash: redactProxyKey(keyHash),
    masked_key_display: String(row.key_display || (secretKey ? formatProxyKeyDisplay(secretKey) : `sk-snp-${keyHash.slice(0, 12)}…${keyHash.slice(-4)}`)),
    secret_key: secretKey || undefined,
    secret_available: Boolean(secretKey),
    allowed_models,
    endpoint_group: String(row.endpoint_group || 'default'),
    max_concurrent: Number(row.max_concurrent),
    enabled: Boolean(row.enabled),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

export async function getProxyKeys(includeSecret = false): Promise<ProxyKey[]> {
  const [rows] = await poolQuery('SELECT * FROM proxy_keys ORDER BY created_at DESC');
  return (rows as Record<string, unknown>[]).map(row => normalizeProxyKey(row, includeSecret));
}

export async function getProxyKeyById(id: string, includeSecret = false): Promise<ProxyKey | null> {
  const [rows] = await poolQuery('SELECT * FROM proxy_keys WHERE id = ?', [id]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? normalizeProxyKey(row, includeSecret) : null;
}

export async function getProxyKeyByHash(keyHash: string): Promise<ProxyKey | null> {
  const [rows] = await poolQuery('SELECT * FROM proxy_keys WHERE key_hash = ? AND enabled = 1', [keyHash]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? normalizeProxyKey(row) : null;
}

export async function createProxyKey(input: CreateProxyKeyInput): Promise<ProxyKey> {
  const db = await getDb();
  const id = uuidv4(); const now = Math.floor(Date.now() / 1000);
  const secretKey = input.secret ? encryptSecret(input.secret) : '';
  const keyDisplay = input.secret ? formatProxyKeyDisplay(input.secret) : '';
  await db.query('INSERT INTO proxy_keys (id, name, key_hash, secret_key, key_display, allowed_models, endpoint_group, max_concurrent, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', [id, input.name, input.key_hash, secretKey, keyDisplay, JSON.stringify(input.allowed_models ?? []), input.endpoint_group?.trim() || 'default', Math.max(1, input.max_concurrent ?? 1), now, now]);
  const [rows] = await db.query('SELECT * FROM proxy_keys WHERE id = ?', [id]);
  return normalizeProxyKey(rows[0], true);
}

export async function updateProxyKey(id: string, input: UpdateProxyKeyInput): Promise<ProxyKey | null> {
  const db = await getDb();
  const existing = await getProxyKeyById(id);
  if (!existing) return null;
  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name.trim()); }
  if (input.allowed_models !== undefined) { updates.push('allowed_models = ?'); values.push(JSON.stringify(input.allowed_models.filter(Boolean))); }
  if (input.endpoint_group !== undefined) { updates.push('endpoint_group = ?'); values.push(input.endpoint_group.trim() || 'default'); }
  if (input.max_concurrent !== undefined) { updates.push('max_concurrent = ?'); values.push(Math.max(1, input.max_concurrent)); }
  if (input.enabled !== undefined) { updates.push('enabled = ?'); values.push(input.enabled ? 1 : 0); }
  if (updates.length === 0) return existing;
  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);
  await db.query(`UPDATE proxy_keys SET ${updates.join(', ')} WHERE id = ?`, values);
  return getProxyKeyById(id);
}

export async function deleteProxyKey(id: string): Promise<boolean> {
  const db = await getDb();
  const [result] = await db.query('DELETE FROM proxy_keys WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export interface RequestLog {
  id: string;
  request_id?: string;
  endpoint_id: string;
  endpoint_name: string;
  proxy_key_id?: string;
  proxy_key_name?: string;
  endpoint_group?: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  success: boolean;
  switched: boolean;
  error?: string;
  model?: string;
  stream?: boolean;
  client_ip?: string;
  first_byte_ms?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  token_estimated?: boolean;
  cost?: number;
  switch_chain?: string;
  is_test?: boolean;
  created_at: number;
}

export interface RequestAttempt {
  id: string;
  request_id?: string;
  endpoint_id: string;
  endpoint_name: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  success: boolean;
  error?: string;
  model?: string;
  created_at: number;
}

export interface LoginAttempt {
  failures: number;
  locked_until: number;
}

function normalizeEndpoint(row: Record<string, unknown>): Endpoint {
  return {
    id: String(row.id),
    name: String(row.name),
    url: String(row.url),
    api_key: String(row.api_key),
    priority: Number(row.priority),
    weight: Number(row.weight),
    endpoint_group: row.endpoint_group ? String(row.endpoint_group) : 'default',
    enabled: Boolean(row.enabled),
    healthy: Boolean(row.healthy),
    last_check: Number(row.last_check),
    error_count: Number(row.error_count),
    cooldown_until: row.cooldown_until ? Number(row.cooldown_until) : undefined,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    sensenova_account_id: row.sensenova_account_id ? String(row.sensenova_account_id) : undefined,
    console_access_token: row.console_access_token ? String(row.console_access_token) : undefined,
    console_access_expires_at: row.console_access_expires_at ? Number(row.console_access_expires_at) : undefined,
    console_refresh_token: row.console_refresh_token ? String(row.console_refresh_token) : undefined,
  };
}

export async function getAllEndpoints(): Promise<Endpoint[]> {
  const [rows] = await poolQuery(
    'SELECT * FROM endpoints ORDER BY priority ASC, weight DESC'
  );
  return (rows as Record<string, unknown>[]).map(normalizeEndpoint);
}

export async function getEnabledEndpoints(): Promise<Endpoint[]> {
  const [rows] = await poolQuery(
    'SELECT * FROM endpoints WHERE enabled = 1 ORDER BY priority ASC, weight DESC'
  );
  return (rows as Record<string, unknown>[]).map(normalizeEndpoint);
}

export async function getAvailableEndpoints(endpointGroup?: string): Promise<Endpoint[]> {
  const groupCondition = endpointGroup ? ' AND endpoint_group = ?' : '';
  const [rows] = await poolQuery(
    `SELECT * FROM endpoints WHERE enabled = 1 AND (cooldown_until IS NULL OR cooldown_until <= UNIX_TIMESTAMP())${groupCondition} ORDER BY priority ASC, weight DESC`,
    endpointGroup ? [endpointGroup] : [],
  );
  return (rows as Record<string, unknown>[]).map(normalizeEndpoint);
}

export async function getHealthyEndpoints(endpointGroup?: string): Promise<Endpoint[]> {
  const groupCondition = endpointGroup ? ' AND endpoint_group = ?' : '';
  const [rows] = await poolQuery(
    `SELECT * FROM endpoints WHERE enabled = 1 AND healthy = 1 AND (cooldown_until IS NULL OR cooldown_until <= UNIX_TIMESTAMP())${groupCondition} ORDER BY priority ASC, weight DESC`,
    endpointGroup ? [endpointGroup] : [],
  );
  return (rows as Record<string, unknown>[]).map(normalizeEndpoint);
}

export async function getEndpoint(id: string): Promise<Endpoint | null> {
  const [rows] = await poolQuery(
    'SELECT * FROM endpoints WHERE id = ?',
    [id]
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? normalizeEndpoint(row) : null;
}

export async function createEndpoint(input: CreateEndpointInput): Promise<Endpoint> {
  const db = await getDb();
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  await db.query(
    `INSERT INTO endpoints (id, name, url, api_key, priority, weight, endpoint_group, enabled, healthy, sensenova_account_id, console_access_token, console_access_expires_at, console_refresh_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.url.replace(/\/$/, ''),
      input.api_key,
      input.priority ?? 0,
      input.weight ?? 1,
      input.endpoint_group?.trim() || 'default',
      input.enabled ? 1 : 0,
      input.sensenova_account_id ?? null,
      input.console_access_token ?? null,
      input.console_access_expires_at ?? null,
      input.console_refresh_token ?? null,
      now,
      now,
    ]
  );

  return (await getEndpoint(id))!;
}

export async function updateEndpoint(id: string, input: UpdateEndpointInput): Promise<Endpoint | null> {
  const db = await getDb();
  const existing = await getEndpoint(id);
  if (!existing) return null;

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name); }
  if (input.url !== undefined) { updates.push('url = ?'); values.push(input.url.replace(/\/$/, '')); }
  if (input.api_key !== undefined) { updates.push('api_key = ?'); values.push(input.api_key); }
  if (input.priority !== undefined) { updates.push('priority = ?'); values.push(input.priority); }
  if (input.weight !== undefined) { updates.push('weight = ?'); values.push(input.weight); }
  if (input.endpoint_group !== undefined) { updates.push('endpoint_group = ?'); values.push(input.endpoint_group.trim() || 'default'); }
  if (input.enabled !== undefined) { updates.push('enabled = ?'); values.push(input.enabled ? 1 : 0); }
  if (input.sensenova_account_id !== undefined) { updates.push('sensenova_account_id = ?'); values.push(input.sensenova_account_id || null); }
  if (input.console_access_token !== undefined) { updates.push('console_access_token = ?'); values.push(input.console_access_token || null); }
  if (input.console_access_expires_at !== undefined) { updates.push('console_access_expires_at = ?'); values.push(input.console_access_expires_at || null); }
  if (input.console_refresh_token !== undefined) { updates.push('console_refresh_token = ?'); values.push(input.console_refresh_token || null); }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);

  await db.query(`UPDATE endpoints SET ${updates.join(', ')} WHERE id = ?`, values);
  return (await getEndpoint(id))!;
}

export async function updateEndpointQuotaTokens(id: string, accessToken: string, expiresAt: number, refreshToken?: string): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  if (refreshToken) {
    await db.query(
      'UPDATE endpoints SET console_access_token = ?, console_access_expires_at = ?, console_refresh_token = ?, updated_at = ? WHERE id = ?',
      [accessToken, expiresAt, refreshToken, now, id]
    );
    return;
  }
  await db.query(
    'UPDATE endpoints SET console_access_token = ?, console_access_expires_at = ?, updated_at = ? WHERE id = ?',
    [accessToken, expiresAt, now, id]
  );
}

export async function deleteEndpoint(id: string): Promise<boolean> {
  const db = await getDb();
  const [result] = await db.query('DELETE FROM endpoints WHERE id = ?', [id]);
  return (result as mysql.ResultSetHeader).affectedRows > 0;
}

export async function markHealthy(id: string): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.query(
    'UPDATE endpoints SET healthy = 1, error_count = 0, cooldown_until = 0, last_check = ?, updated_at = ? WHERE id = ?',
    [now, now, id]
  );
}

export async function markRateLimited(id: string, cooldownSeconds = 60): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.query(
    'UPDATE endpoints SET cooldown_until = ?, last_check = ?, updated_at = ? WHERE id = ?',
    [now + cooldownSeconds, now, now, id]
  );
}

export async function markUnhealthy(id: string): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.query(
    'UPDATE endpoints SET healthy = 0, error_count = error_count + 1, last_check = ?, updated_at = ? WHERE id = ?',
    [now, now, id]
  );
}

export async function addLog(log: Omit<RequestLog, 'id' | 'created_at'>): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  await db.query(
    `INSERT INTO request_logs (id, request_id, endpoint_id, endpoint_name, proxy_key_id, proxy_key_name, endpoint_group, method, path, status, duration, success, switched, error, model, stream, client_ip, first_byte_ms, prompt_tokens, completion_tokens, total_tokens, token_estimated, cost, switch_chain, is_test, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, log.request_id ?? null, log.endpoint_id, log.endpoint_name, log.proxy_key_id ?? null, log.proxy_key_name ?? null, log.endpoint_group ?? null,
      log.method, log.path, log.status,
      log.duration, log.success ? 1 : 0, log.switched ? 1 : 0, log.error ?? null,
      log.model ?? null, log.stream ? 1 : 0, log.client_ip ?? null,
      log.first_byte_ms ?? null, log.prompt_tokens ?? null,
      log.completion_tokens ?? null, log.total_tokens ?? null, log.token_estimated ? 1 : 0,
      log.cost ?? null, log.switch_chain ?? null, log.is_test ? 1 : 0, now,
    ]
  );
  return id;
}

export async function addRequestAttempt(attempt: Omit<RequestAttempt, 'id' | 'created_at'>): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.query(
    `INSERT INTO request_attempts (id, request_id, endpoint_id, endpoint_name, method, path, status, duration, success, error, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, attempt.request_id ?? null, attempt.endpoint_id, attempt.endpoint_name,
      attempt.method, attempt.path, attempt.status, attempt.duration, attempt.success ? 1 : 0,
      attempt.error ?? null, attempt.model ?? null, Math.floor(Date.now() / 1000),
    ]
  );
  return id;
}

export async function updateRequestAttempt(id: string, update: { status: number; success: boolean; error?: string; duration: number }): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE request_attempts SET status = ?, success = ?, error = ?, duration = ? WHERE id = ?',
    [update.status, update.success ? 1 : 0, update.error ?? null, update.duration, id]
  );
}

export async function getAttemptsForRequest(requestId: string): Promise<RequestAttempt[]> {
  const [rows] = await poolQuery(
    'SELECT * FROM request_attempts WHERE request_id = ? ORDER BY created_at ASC',
    [requestId]
  );
  return (rows as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    request_id: row.request_id ? String(row.request_id) : undefined,
    endpoint_id: String(row.endpoint_id),
    endpoint_name: String(row.endpoint_name),
    method: String(row.method),
    path: String(row.path),
    status: Number(row.status),
    duration: Number(row.duration),
    success: Boolean(row.success),
    error: row.error ? String(row.error) : undefined,
    model: row.model ? String(row.model) : undefined,
    created_at: Number(row.created_at),
  })) as RequestAttempt[];
}

export async function getLoginAttempt(loginKey: string): Promise<LoginAttempt | null> {
  const [rows] = await poolQuery(
    'SELECT failures, locked_until FROM login_attempts WHERE login_key = ?',
    [loginKey]
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  return {
    failures: Number(row.failures),
    locked_until: Number(row.locked_until),
  };
}

export async function recordLoginFailure(loginKey: string, maxFailures: number, lockSeconds: number): Promise<LoginAttempt> {
  const db = await getDb();
  const current = await getLoginAttempt(loginKey);
  const now = Math.floor(Date.now() / 1000);
  const failures = current && current.locked_until <= now ? current.failures + 1 : (current?.failures ?? 0) + 1;
  const lockedUntil = failures >= maxFailures ? now + lockSeconds : 0;

  if (current) {
    await db.query(
      'UPDATE login_attempts SET failures = ?, locked_until = ?, updated_at = ? WHERE login_key = ?',
      [failures, lockedUntil, now, loginKey]
    );
  } else {
    await db.query(
      'INSERT INTO login_attempts (login_key, failures, locked_until, updated_at) VALUES (?, ?, ?, ?)',
      [loginKey, failures, lockedUntil, now]
    );
  }
  return { failures, locked_until: lockedUntil };
}

export async function clearLoginAttempt(loginKey: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM login_attempts WHERE login_key = ?', [loginKey]);
}

export async function getLogs(page: number, pageSize: number): Promise<{ logs: RequestLog[]; total: number }> {
  const db = await getDb();
  const [countRows] = await db.query('SELECT COUNT(*) AS count FROM request_logs');
  const total = Number((countRows as Record<string, unknown>[])[0].count);
  const [rows] = await db.query(
    'SELECT * FROM request_logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [pageSize, (page - 1) * pageSize]
  );
  const logs = (rows as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    request_id: r.request_id ? String(r.request_id) : undefined,
    endpoint_id: String(r.endpoint_id),
    endpoint_name: String(r.endpoint_name),
    proxy_key_id: r.proxy_key_id ? String(r.proxy_key_id) : undefined,
    proxy_key_name: r.proxy_key_name ? String(r.proxy_key_name) : undefined,
    endpoint_group: r.endpoint_group ? String(r.endpoint_group) : undefined,
    method: String(r.method),
    path: String(r.path),
    status: Number(r.status),
    duration: Number(r.duration),
    success: Boolean(r.success),
    switched: Boolean(r.switched),
    error: r.error ? String(r.error) : undefined,
    model: r.model ? String(r.model) : undefined,
    stream: Boolean(r.stream),
    client_ip: r.client_ip ? String(r.client_ip) : undefined,
    first_byte_ms: r.first_byte_ms ? Number(r.first_byte_ms) : undefined,
    prompt_tokens: r.prompt_tokens ? Number(r.prompt_tokens) : undefined,
    completion_tokens: r.completion_tokens ? Number(r.completion_tokens) : undefined,
    total_tokens: r.total_tokens !== null ? Number(r.total_tokens) : undefined,
    token_estimated: Boolean(r.token_estimated),
    cost: r.cost ? Number(r.cost) : undefined,
    switch_chain: r.switch_chain ? String(r.switch_chain) : undefined,
    is_test: Boolean(r.is_test),
    created_at: Number(r.created_at),
  }));
  return { logs, total };
}

export interface UsageStatsFilters {
  since?: number;
  endpointId?: string;
  model?: string;
}

export interface UsageStats {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  by_model: Array<{
    model: string;
    requests: number;
    successful_requests: number;
    failed_requests: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  }>;
}

export async function getUsageStats(filters: UsageStatsFilters = {}): Promise<UsageStats> {
  const db = await getDb();
  const conditions = ['is_test = 0'];
  const values: unknown[] = [];
  if (filters.since !== undefined) { conditions.push('created_at >= ?'); values.push(filters.since); }
  if (filters.endpointId) { conditions.push('endpoint_id = ?'); values.push(filters.endpointId); }
  if (filters.model) {
    if (filters.model === '未知模型') conditions.push("(model IS NULL OR model = '')");
    else { conditions.push('model = ?'); values.push(filters.model); }
  }
  const where = conditions.join(' AND ');

  const [summaryRows] = await db.query(`
    SELECT COUNT(*) AS total_requests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successful_requests,
      SUM(CASE WHEN success = 1 THEN 0 ELSE 1 END) AS failed_requests,
      SUM(prompt_tokens) AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(total_tokens) AS total_tokens
    FROM request_logs WHERE ${where}
  `, values);

  const summaryRow = (summaryRows as Record<string, unknown>[])[0];
  const summary: Record<string, number | null> = {};
  for (const key of Object.keys(summaryRow)) {
    summary[key] = summaryRow[key] !== null ? Number(summaryRow[key]) : null;
  }

  const [modelRows] = await db.query(`
    SELECT COALESCE(NULLIF(model, ''), '未知模型') AS model,
      COUNT(*) AS requests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successful_requests,
      SUM(CASE WHEN success = 1 THEN 0 ELSE 1 END) AS failed_requests,
      SUM(prompt_tokens) AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(total_tokens) AS total_tokens
    FROM request_logs WHERE ${where}
    GROUP BY COALESCE(NULLIF(model, ''), '未知模型') ORDER BY requests DESC
  `, values);

  const by_model = (modelRows as Record<string, unknown>[]).map(row => ({
    model: String(row.model),
    requests: Number(row.requests),
    successful_requests: Number(row.successful_requests),
    failed_requests: Number(row.failed_requests),
    prompt_tokens: row.prompt_tokens !== null ? Number(row.prompt_tokens) : null,
    completion_tokens: row.completion_tokens !== null ? Number(row.completion_tokens) : null,
    total_tokens: row.total_tokens !== null ? Number(row.total_tokens) : null,
  }));

  return {
    total_requests: summary.total_requests ?? 0,
    successful_requests: summary.successful_requests ?? 0,
    failed_requests: summary.failed_requests ?? 0,
    prompt_tokens: summary.prompt_tokens ?? null,
    completion_tokens: summary.completion_tokens ?? null,
    total_tokens: summary.total_tokens ?? null,
    by_model,
  };
}

export async function getLoggedModels(): Promise<string[]> {
  const [rows] = await poolQuery(
    "SELECT DISTINCT COALESCE(NULLIF(model, ''), '未知模型') AS model FROM request_logs WHERE is_test = 0 ORDER BY model"
  );
  return (rows as { model: string }[]).map(row => row.model);
}

export interface UsageTrendPoint {
  bucket: number;
  model: string;
  requests: number;
  total_tokens: number;
}

export async function getUsageTrends(since: number, bucketSeconds: number): Promise<UsageTrendPoint[]> {
  const [rows] = await poolQuery(`
    SELECT FLOOR(created_at / ?) * ? AS bucket,
      COALESCE(NULLIF(model, ''), '未知模型') AS model,
      COUNT(*) AS requests,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM request_logs
    WHERE is_test = 0 AND created_at >= ?
    GROUP BY FLOOR(created_at / ?) * ?, COALESCE(NULLIF(model, ''), '未知模型')
    ORDER BY bucket ASC, model ASC
  `, [bucketSeconds, bucketSeconds, since, bucketSeconds, bucketSeconds]);
  return (rows as Record<string, unknown>[]).map(row => ({
    bucket: Number(row.bucket), model: String(row.model), requests: Number(row.requests), total_tokens: Number(row.total_tokens),
  }));
}
