import { NextRequest, NextResponse } from 'next/server';
import { createProxyKey, getProxyKeys } from '@/lib/db';
import { createProxyKeySecret, hashProxyKey } from '@/lib/proxy-access';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json((await getProxyKeys()).map(key => ({ ...key, key_hash: `${key.key_hash.slice(0, 8)}…` })));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; allowed_models?: string[]; endpoint_group?: string; max_concurrent?: number };
    if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const secret = createProxyKeySecret();
    const key = await createProxyKey({ name: body.name.trim(), key_hash: hashProxyKey(secret), allowed_models: body.allowed_models?.filter(Boolean) ?? [], endpoint_group: body.endpoint_group, max_concurrent: body.max_concurrent });
    return NextResponse.json({ ...key, secret }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create proxy key' }, { status: 400 }); }
}
