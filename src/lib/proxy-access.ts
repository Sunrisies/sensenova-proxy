import { createHash, randomBytes } from 'crypto';

const active = new Map<string, number>();

export function hashProxyKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createProxyKeySecret(): string {
  return `sk-snp-${randomBytes(24).toString('base64url')}`;
}

/** Single-process semaphore. Do not use this when the proxy is scaled beyond one Node process. */
export function acquireConcurrency(keyId: string, model: string, maximum: number): (() => void) | null {
  const slot = `${keyId}:${model}`;
  const current = active.get(slot) ?? 0;
  if (current >= maximum) return null;
  active.set(slot, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (active.get(slot) ?? 1) - 1;
    if (next <= 0) active.delete(slot); else active.set(slot, next);
  };
}

export function getActiveConcurrency(keyId: string, model: string): number {
  return active.get(`${keyId}:${model}`) ?? 0;
}
