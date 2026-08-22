const sqlite3 = require('better-sqlite3');
const mysql = require('mysql2/promise');
const path = require('path');

async function main() {
  const DB_PATH = path.join(process.cwd(), 'data', 'proxy.db');
  console.log(`[1/5] Opening SQLite: ${DB_PATH}`);
  const sqlite = sqlite3(DB_PATH);

  const endpoints = sqlite.prepare('SELECT * FROM endpoints').all() as any[];
  const requestLogs = sqlite.prepare('SELECT * FROM request_logs').all() as any[];
  const requestAttempts = sqlite.prepare('SELECT * FROM request_attempts').all() as any[];
  const loginAttempts = sqlite.prepare('SELECT * FROM login_attempts').all() as any[];

  sqlite.close();
  console.log(`[2/5] Read SQLite: ${endpoints.length} endpoints, ${requestLogs.length} logs, ${requestAttempts.length} attempts, ${loginAttempts.length} login_attempts`);

  console.log('[3/5] Connecting to MySQL...');
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  });

  try {
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.MYSQL_DATABASE || 'sensenova_proxy'}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await pool.end();
  }

  const appPool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'sensenova_proxy',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  });

  const p = appPool as any;

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
      cost DOUBLE,
      switch_chain TEXT,
      is_test TINYINT(1) DEFAULT 0,
      created_at INT NOT NULL
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
      created_at INT NOT NULL
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

  console.log('[4/5] Migrating data...');

  // Wipe existing MySQL data (in case of re-run)
  await p.query('SET FOREIGN_KEY_CHECKS = 0');
  await p.query('TRUNCATE TABLE request_logs');
  await p.query('TRUNCATE TABLE request_attempts');
  await p.query('TRUNCATE TABLE login_attempts');
  await p.query('TRUNCATE TABLE endpoints');
  await p.query('SET FOREIGN_KEY_CHECKS = 1');

  const endpointSql = 'INSERT INTO endpoints (id, name, url, api_key, priority, weight, enabled, healthy, last_check, error_count, cooldown_until, sensenova_account_id, console_access_token, console_access_expires_at, console_refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  for (const row of endpoints) {
    await p.query(endpointSql, [
      row.id, row.name, row.url, row.api_key, row.priority, row.weight,
      row.enabled, row.healthy, row.last_check, row.error_count,
      row.cooldown_until ?? 0, row.sensenova_account_id ?? null,
      row.console_access_token ?? null, row.console_access_expires_at ?? null,
      row.console_refresh_token ?? null, row.created_at, row.updated_at,
    ]);
  }
  console.log(`  - endpoints: ${endpoints.length}`);

  const logSql = 'INSERT INTO request_logs (id, request_id, endpoint_id, endpoint_name, method, path, status, duration, success, switched, error, model, stream, client_ip, first_byte_ms, prompt_tokens, completion_tokens, total_tokens, cost, switch_chain, is_test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  for (const row of requestLogs) {
    await p.query(logSql, [
      row.id, row.request_id ?? null, row.endpoint_id, row.endpoint_name,
      row.method, row.path, row.status, row.duration, row.success, row.switched,
      row.error ?? null, row.model ?? null, row.stream, row.client_ip ?? null,
      row.first_byte_ms ?? null, row.prompt_tokens ?? null,
      row.completion_tokens ?? null, row.total_tokens ?? null, row.cost ?? null,
      row.switch_chain ?? null, row.is_test ?? 0, row.created_at,
    ]);
  }
  console.log(`  - request_logs: ${requestLogs.length}`);

  const attemptSql = 'INSERT INTO request_attempts (id, request_id, endpoint_id, endpoint_name, method, path, status, duration, success, error, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  for (const row of requestAttempts) {
    await p.query(attemptSql, [
      row.id, row.request_id ?? null, row.endpoint_id, row.endpoint_name,
      row.method, row.path, row.status, row.duration, row.success,
      row.error ?? null, row.model ?? null, row.created_at,
    ]);
  }
  console.log(`  - request_attempts: ${requestAttempts.length}`);

  const loginSql = 'INSERT INTO login_attempts (login_key, failures, locked_until, updated_at) VALUES (?, ?, ?, ?)';
  for (const row of loginAttempts) {
    await p.query(loginSql, [row.login_key, row.failures, row.locked_until, row.updated_at]);
  }
  console.log(`  - login_attempts: ${loginAttempts.length}`);

  console.log('\n[5/5] Verification:');
  const [endCheck] = await p.query('SELECT COUNT(*) AS c FROM endpoints');
  const [logCheck] = await p.query('SELECT COUNT(*) AS c FROM request_logs');
  const [attCheck] = await p.query('SELECT COUNT(*) AS c FROM request_attempts');
  const [loginCheck] = await p.query('SELECT COUNT(*) AS c FROM login_attempts');
  console.log(`  endpoints:          SQLite=${endpoints.length}  MySQL=${(endCheck as any[])[0].c}`);
  console.log(`  request_logs:       SQLite=${requestLogs.length}  MySQL=${(logCheck as any[])[0].c}`);
  console.log(`  request_attempts:   SQLite=${requestAttempts.length}  MySQL=${(attCheck as any[])[0].c}`);
  console.log(`  login_attempts:     SQLite=${loginAttempts.length}  MySQL=${(loginCheck as any[])[0].c}`);

  await appPool.end();
  console.log('\nDone! Backup your SQLite file: data/proxy.db.bak');
}

main().catch(err => { console.error(err); process.exit(1); });
