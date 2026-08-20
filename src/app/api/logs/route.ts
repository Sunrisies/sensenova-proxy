import { NextRequest } from 'next/server';
import { getRecentLogs, addLog } from '@/lib/db';
import { onLog } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const logs = getRecentLogs(limit);
  return Response.json(logs);
}

// POST for testing - adds a manual log entry
export async function POST(request: NextRequest) {
  const body = await request.json();
  addLog(body);
  return Response.json({ success: true });
}
