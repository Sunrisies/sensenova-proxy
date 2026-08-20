import { NextRequest } from 'next/server';
import { getLogs, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));
  return Response.json({ page, pageSize, ...getLogs(page, pageSize) });
}

// POST for testing - adds a manual log entry
export async function POST(request: NextRequest) {
  const body = await request.json();
  addLog(body);
  return Response.json({ success: true });
}
