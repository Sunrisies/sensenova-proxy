import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = path.join(process.cwd(), 'data', 'proxy.db');

let db: Database.Database | null = null;

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  api_key: string;
  priority: number;
  weight: number;
  enabled: boolean;
  healthy: boolean;
  last_check: number;
  error_count: number;
  created_at: number;
  updated_at: number;
}

export interface CreateEndpointInput {
  name: string;
  url: string;
  api_key: string;
  priority?: number;
  weight?: number;
  enabled?: boolean;
}

export interface UpdateEndpointInput {
  name?: string;
  url?: string;
  api_key?: string;
  priority?: number;
  weight?: number;
  enabled?: boolean;
}

export interface RequestLog {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
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
  cost?: number;
  switch_chain?: string;
  created_at: number;
}

function getDb(): Database.Database {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS endpoints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        weight INTEGER DEFAULT 1,
        enabled INTEGER DEFAULT 1,
        healthy INTEGER DEFAULT 1,
        last_check INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS request_logs (
        id TEXT PRIMARY KEY,
        endpoint_id TEXT NOT NULL,
        endpoint_name TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        success INTEGER NOT NULL,
        switched INTEGER DEFAULT 0,
        error TEXT,
        model TEXT,
        stream INTEGER DEFAULT 0,
        client_ip TEXT,
        first_byte_ms INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        cost REAL,
        switch_chain TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_endpoints_priority ON endpoints(priority ASC, weight DESC);
    `);

    // Add fields when upgrading databases created by earlier versions.
    const columns = db.prepare('PRAGMA table_info(request_logs)').all() as { name: string }[];
    const existing = new Set(columns.map(column => column.name));
    const migrations: Record<string, string> = {
      model: 'ALTER TABLE request_logs ADD COLUMN model TEXT',
      stream: 'ALTER TABLE request_logs ADD COLUMN stream INTEGER DEFAULT 0',
      client_ip: 'ALTER TABLE request_logs ADD COLUMN client_ip TEXT',
      first_byte_ms: 'ALTER TABLE request_logs ADD COLUMN first_byte_ms INTEGER',
      prompt_tokens: 'ALTER TABLE request_logs ADD COLUMN prompt_tokens INTEGER',
      completion_tokens: 'ALTER TABLE request_logs ADD COLUMN completion_tokens INTEGER',
      total_tokens: 'ALTER TABLE request_logs ADD COLUMN total_tokens INTEGER',
      cost: 'ALTER TABLE request_logs ADD COLUMN cost REAL',
      switch_chain: 'ALTER TABLE request_logs ADD COLUMN switch_chain TEXT',
    };
    for (const [column, statement] of Object.entries(migrations)) {
      if (!existing.has(column)) db.exec(statement);
    }
  }
  return db;
}

// Endpoint CRUD
export function getAllEndpoints(): Endpoint[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM endpoints ORDER BY priority ASC, weight DESC').all() as Record<string, unknown>[];
  return rows.map(normalizeEndpoint);
}

export function getEnabledEndpoints(): Endpoint[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM endpoints WHERE enabled = 1 ORDER BY priority ASC, weight DESC').all() as Record<string, unknown>[];
  return rows.map(normalizeEndpoint);
}

export function getHealthyEndpoints(): Endpoint[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM endpoints WHERE enabled = 1 AND healthy = 1 ORDER BY priority ASC, weight DESC').all() as Record<string, unknown>[];
  return rows.map(normalizeEndpoint);
}

export function getEndpoint(id: string): Endpoint | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? normalizeEndpoint(row) : null;
}

export function createEndpoint(input: CreateEndpointInput): Endpoint {
  const db = getDb();
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO endpoints (id, name, url, api_key, priority, weight, enabled, healthy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    input.name,
    input.url.replace(/\/$/, ''),
    input.api_key,
    input.priority ?? 0,
    input.weight ?? 1,
    input.enabled ?? 1,
    now,
    now
  );

  return getEndpoint(id)!;
}

export function updateEndpoint(id: string, input: UpdateEndpointInput): Endpoint | null {
  const db = getDb();
  const existing = getEndpoint(id);
  if (!existing) return null;

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name); }
  if (input.url !== undefined) { updates.push('url = ?'); values.push(input.url.replace(/\/$/, '')); }
  if (input.api_key !== undefined) { updates.push('api_key = ?'); values.push(input.api_key); }
  if (input.priority !== undefined) { updates.push('priority = ?'); values.push(input.priority); }
  if (input.weight !== undefined) { updates.push('weight = ?'); values.push(input.weight); }
  if (input.enabled !== undefined) { updates.push('enabled = ?'); values.push(input.enabled ? 1 : 0); }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE endpoints SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getEndpoint(id)!;
}

export function deleteEndpoint(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM endpoints WHERE id = ?').run(id);
  return result.changes > 0;
}

// Health check
export function markHealthy(id: string): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE endpoints SET healthy = 1, error_count = 0, last_check = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id);
}

export function markUnhealthy(id: string): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE endpoints SET healthy = 0, error_count = error_count + 1, last_check = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id);
}

// Request logs
export function addLog(log: Omit<RequestLog, 'id' | 'created_at'>): void {
  const db = getDb();
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO request_logs (id, endpoint_id, endpoint_name, method, path, status, duration, success, switched, error, model, stream, client_ip, first_byte_ms, prompt_tokens, completion_tokens, total_tokens, cost, switch_chain, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, log.endpoint_id, log.endpoint_name, log.method, log.path, log.status,
    log.duration, log.success ? 1 : 0, log.switched ? 1 : 0, log.error ?? null,
    log.model ?? null, log.stream ? 1 : 0, log.client_ip ?? null,
    log.first_byte_ms ?? null, log.prompt_tokens ?? null,
    log.completion_tokens ?? null, log.total_tokens ?? null, log.cost ?? null,
    log.switch_chain ?? null, now,
  );
}

export function getLogs(page: number, pageSize: number): { logs: RequestLog[]; total: number } {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS count FROM request_logs').get() as { count: number }).count;
  const rows = db.prepare('SELECT * FROM request_logs ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?')
    .all(pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  const logs = rows.map(r => ({
    ...r,
    success: Boolean(r.success),
    switched: Boolean(r.switched),
    stream: Boolean(r.stream),
  })) as RequestLog[];
  return { logs, total };
}

function normalizeEndpoint(row: Record<string, unknown>): Endpoint {
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    api_key: row.api_key as string,
    priority: row.priority as number,
    weight: row.weight as number,
    enabled: Boolean(row.enabled),
    healthy: Boolean(row.healthy),
    last_check: row.last_check as number,
    error_count: row.error_count as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}
