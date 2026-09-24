import { NextResponse } from 'next/server';
import { getProxyKeyById } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = await getProxyKeyById(id, true);
  if (!key) return NextResponse.json({ error: 'Proxy key not found' }, { status: 404 });
  if (!key.secret_available) return NextResponse.json({ error: 'Secret is not recoverable for this legacy key' }, { status: 410 });
  return NextResponse.json({ secret: key.secret_key });
}
