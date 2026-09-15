import { NextResponse } from 'next/server';
import { deleteProxyKey } from '@/lib/db';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await deleteProxyKey(id))) return NextResponse.json({ error: 'Proxy key not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
