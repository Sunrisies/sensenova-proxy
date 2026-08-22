import { NextRequest } from 'next/server';
import { getLogs, addLog, getAttemptsForRequest } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));
  const result = await getLogs(page, pageSize);
  const logs = await Promise.all(result.logs.map(async (log) => ({ ...log, attempts: log.request_id ? await getAttemptsForRequest(log.request_id) : [] })));
  return Response.json({ page, pageSize, ...result, logs });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  await addLog(body);
  return Response.json({ success: true });
}
