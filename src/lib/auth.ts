const SESSION_COOKIE = 'sensenova_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function sessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET or TOKEN_ENCRYPTION_KEY is required');
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

export function getAdminCookieName(): string { return SESSION_COOKIE; }

export async function createAdminSession(): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `admin.${expires}`;
  return `${payload}.${await sign(payload)}`;
}

export async function isValidAdminSession(value: string | undefined): Promise<boolean> {
  try {
    if (!value) return false;
    const [role, expiresText, signature] = value.split('.');
    const expires = Number(expiresText);
    if (role !== 'admin' || !Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !signature) return false;
    const expected = await sign(`${role}.${expires}`);
    return expected === signature;
  } catch {
    return false;
  }
}

export async function isAdminRequest(request: Request): Promise<boolean> {
  const cookie = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${SESSION_COOKIE}=`));
  return isValidAdminSession(cookie?.slice(SESSION_COOKIE.length + 1));
}

export function isProxyRequestAuthorized(request: Request): boolean {
  const configured = process.env.PROXY_API_KEYS?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  if (configured.length === 0) return false;
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') === true && configured.includes(header.slice(7));
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
