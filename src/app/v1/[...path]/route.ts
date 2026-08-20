import { NextRequest } from 'next/server';
import { proxyRequest, handleCORS } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return handleCORS();
}

async function forward(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyRequest(request, path.join('/'));
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
