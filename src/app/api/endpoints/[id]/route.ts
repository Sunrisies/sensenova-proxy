import { NextRequest, NextResponse } from 'next/server';
import { getEndpoint, updateEndpoint, deleteEndpoint, type UpdateEndpointInput } from '@/lib/db';
import { getQuotaAuthorization } from '@/lib/quota';

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
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    api_key: endpoint.api_key.slice(0, 6) + '***' + endpoint.api_key.slice(-4),
    priority: endpoint.priority,
    weight: endpoint.weight,
    enabled: endpoint.enabled,
    healthy: endpoint.healthy,
    error_count: endpoint.error_count,
    ...getQuotaAuthorization(endpoint),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json() as UpdateEndpointInput;
    const endpointInput = { ...body };
    delete endpointInput.sensenova_account_id;
    delete endpointInput.console_access_token;
    delete endpointInput.console_access_expires_at;
    delete endpointInput.console_refresh_token;
    const updated = updateEndpoint(id, endpointInput);
    if (!updated) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }
    return NextResponse.json({ id: updated.id, ...getQuotaAuthorization(updated) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request body' }, { status: 400 });
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
