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
  updateEndpointQuotaTokens(endpoint.id, encryptSecret(data.access_token), getJwtExpiry(data.access_token), nextRefresh);
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

async function getModelIds(endpoint: Endpoint): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.url}/models`, { headers: { Authorization: `Bearer ${endpoint.api_key}` }, signal: controller.signal });
    if (!response.ok) throw new Error(`Model list request failed (${response.status})`);
    const data = await response.json() as { data?: unknown } | unknown[];
    const models = Array.isArray(data) ? data : data.data;
    if (!Array.isArray(models)) throw new Error('Model list response is invalid');
    return models.flatMap(model => typeof model === 'object' && model && typeof (model as { id?: unknown }).id === 'string' ? [(model as { id: string }).id] : []);
  } finally {
    clearTimeout(timer);
  }
}

async function requestQuota(accountId: string, modelIds: string[], token: string): Promise<Response> {
  const params = new URLSearchParams({ account_id: accountId });
  modelIds.forEach(id => params.append('model_ids', id));
  return fetch(`https://platform.sensenova.cn/lite/console/v1/user/coding-plan/usages?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

export async function getEndpointQuota(endpoint: Endpoint) {
  if (!authorizationConfigured(endpoint)) return { id: endpoint.id, name: endpoint.name, authorization: 'not_configured' as const };
  try {
    const modelIds = await getModelIds(endpoint);
    if (!modelIds.length) throw new Error('No models are available for this endpoint');
    let { token, expiresAt } = await getAccessToken(endpoint);
    let response = await requestQuota(endpoint.sensenova_account_id!, modelIds, token);
    if (response.status === 401) {
      ({ token, expiresAt } = await getAccessToken(endpoint, true));
      response = await requestQuota(endpoint.sensenova_account_id!, modelIds, token);
    }
    if (!response.ok) throw new Error(`Quota request failed (${response.status})`);
    const payload = await response.json() as { model_remaining_percent?: Record<string, number> };
    return { id: endpoint.id, name: endpoint.name, authorization: 'valid' as const, expires_at: expiresAt, model_remaining_percent: payload.model_remaining_percent ?? {} };
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
