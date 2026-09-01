import { decryptSecret, encryptSecret, getJwtExpiry } from './crypto';
import { updateEndpointQuotaTokens, type Endpoint } from './db';

const REFRESH_WINDOW_SECONDS = 600;
const TIMEOUT_MS = 10000;
const refreshLocks = new Map<string, Promise<string>>();

type RefreshResponse = { access_token?: unknown; refresh_token?: unknown };

function authorizationConfigured(endpoint: Endpoint): boolean {
  return Boolean(endpoint.sensenova_account_id && endpoint.console_access_token && endpoint.console_refresh_token);
}

async function refreshAccessToken(endpoint: Endpoint): Promise<string> {
  const existing = refreshLocks.get(endpoint.id);
  if (existing) return existing;
  const refresh = refreshAccessTokenUnlocked(endpoint);
  refreshLocks.set(endpoint.id, refresh);
  try {
    return await refresh;
  } finally {
    refreshLocks.delete(endpoint.id);
  }
}

async function refreshAccessTokenUnlocked(endpoint: Endpoint): Promise<string> {
  if (!endpoint.console_refresh_token) throw new Error('Quota refresh token is not configured');
  const refreshToken = decryptSecret(endpoint.console_refresh_token);
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: 'nova', refresh_token: refreshToken });
  const response = await fetch('https://signin.sensecore.cn/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`OAuth refresh failed (${response.status})`);
  const data = await response.json() as RefreshResponse;
  if (typeof data.access_token !== 'string') throw new Error('OAuth refresh response has no access token');
  const nextRefresh = typeof data.refresh_token === 'string' ? encryptSecret(data.refresh_token) : undefined;
  await updateEndpointQuotaTokens(endpoint.id, encryptSecret(data.access_token), getJwtExpiry(data.access_token), nextRefresh);
  return data.access_token;
}

async function getAccessToken(endpoint: Endpoint, forceRefresh = false): Promise<{ token: string; expiresAt: number }> {
  if (!authorizationConfigured(endpoint)) throw new Error('Quota authorization is not configured');
  const expiresAt = endpoint.console_access_expires_at ?? 0;
  if (forceRefresh || expiresAt - Math.floor(Date.now() / 1000) <= REFRESH_WINDOW_SECONDS) {
    const token = await refreshAccessToken(endpoint);
    return { token, expiresAt: getJwtExpiry(token) };
  }
  return { token: decryptSecret(endpoint.console_access_token!), expiresAt };
}

export interface PoolWindow {
  limit: number;
  used: number;
  remaining: number;
  reset_at: number;
}

export interface QuotaPool {
  id: string;
  name: string;
  model_ids: string[];
  window_5h: PoolWindow;
  window_7d: PoolWindow;
  pool_type: string;
}

interface PoolUsageResponse {
  plan?: { id?: string; name?: string };
  pools?: Array<{
    id?: string;
    name?: string;
    model_ids?: string[];
    window_5h?: { limit?: string; used?: string; remaining?: string; reset_at?: string };
    window_7d?: { limit?: string; used?: string; remaining?: string; reset_at?: string };
    pool_type?: string;
  }>;
}

function parseWindow(window?: { limit?: string; used?: string; remaining?: string; reset_at?: string }): PoolWindow {
  return {
    limit: Number(window?.limit ?? 0),
    used: Number(window?.used ?? 0),
    remaining: Number(window?.remaining ?? 0),
    reset_at: Number(window?.reset_at ?? 0),
  };
}

async function requestPoolUsage(accountId: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ account_id: accountId });
    return await fetch(`https://platform.sensenova.cn/lite/console/v1/tokenplan/pool-usage?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getEndpointQuota(endpoint: Endpoint) {
  if (!authorizationConfigured(endpoint)) return { id: endpoint.id, name: endpoint.name, authorization: 'not_configured' as const };
  try {
    let { token, expiresAt } = await getAccessToken(endpoint);
    let response = await requestPoolUsage(endpoint.sensenova_account_id!, token);
    if (response.status === 401) {
      ({ token, expiresAt } = await getAccessToken(endpoint, true));
      response = await requestPoolUsage(endpoint.sensenova_account_id!, token);
    }
    if (!response.ok) throw new Error(`Quota request failed (${response.status})`);
    const payload = await response.json() as PoolUsageResponse;
    const pools: QuotaPool[] = (payload.pools ?? []).map((pool) => ({
      id: pool.id ?? '',
      name: pool.name ?? '未命名积分池',
      model_ids: pool.model_ids ?? [],
      window_5h: parseWindow(pool.window_5h),
      window_7d: parseWindow(pool.window_7d),
      pool_type: pool.pool_type ?? 'default',
    }));
    return {
      id: endpoint.id,
      name: endpoint.name,
      authorization: 'valid' as const,
      expires_at: expiresAt,
      plan: payload.plan?.name ?? null,
      pools,
    };
  } catch (error) {
    return { id: endpoint.id, name: endpoint.name, authorization: 'invalid' as const, error: error instanceof Error ? error.message : 'Quota request failed' };
  }
}

export function encryptQuotaInput(input: { sensenova_account_id?: string; console_access_token?: string; console_refresh_token?: string }) {
  const hasCredentials = input.sensenova_account_id || input.console_access_token || input.console_refresh_token;
  if (!hasCredentials) return input;
  if (!input.sensenova_account_id || !input.console_access_token || !input.console_refresh_token) {
    throw new Error('Account ID, access token, and refresh token must be provided together');
  }
  return {
    sensenova_account_id: input.sensenova_account_id,
    console_access_token: encryptSecret(input.console_access_token),
    console_access_expires_at: getJwtExpiry(input.console_access_token),
    console_refresh_token: encryptSecret(input.console_refresh_token),
  };
}

export function getQuotaAuthorization(endpoint: Endpoint) {
  if (!authorizationConfigured(endpoint)) return { quota_authorization: 'not_configured' as const };
  return { quota_authorization: 'valid' as const, quota_expires_at: endpoint.console_access_expires_at };
}
