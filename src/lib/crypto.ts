import crypto from 'crypto';

const PREFIX = 'v1';

function getKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error('TOKEN_ENCRYPTION_KEY is required for quota authorization');
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value: string): string {
  const [version, iv, tag, encrypted] = value.split('.');
  if (version !== PREFIX || !iv || !tag || !encrypted) throw new Error('Invalid encrypted quota credential');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function getJwtExpiry(token: string): number {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Invalid OAuth access token');
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
  if (typeof parsed.exp !== 'number') throw new Error('OAuth access token has no expiry');
  return parsed.exp;
}
