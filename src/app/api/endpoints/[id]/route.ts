import { NextRequest, NextResponse } from 'next/server';
import { getEndpoint, updateEndpoint, deleteEndpoint, type UpdateEndpointInput } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const endpoint = getEndpoint(id);
  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  }
  return NextResponse.json({
    ...endpoint,
    api_key: endpoint.api_key.slice(0, 6) + '***' + endpoint.api_key.slice(-4),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json() as UpdateEndpointInput;
    const updated = updateEndpoint(id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteEndpoint(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
