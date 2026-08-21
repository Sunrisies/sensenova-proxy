import { NextRequest, NextResponse } from 'next/server';
import { getEndpoint, updateEndpoint } from '@/lib/db';
import { encryptQuotaInput, getQuotaAuthorization } from '@/lib/quota';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getEndpoint(id)) return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });

  try {
    const body = await request.json() as {
      sensenova_account_id?: string;
      console_access_token?: string;
      console_refresh_token?: string;
    };
    const credentials = encryptQuotaInput(body);
    const endpoint = updateEndpoint(id, credentials);
    return NextResponse.json({ id, ...getQuotaAuthorization(endpoint!) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid authorization' }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const endpoint = updateEndpoint(id, {
    sensenova_account_id: '',
    console_access_token: '',
    console_access_expires_at: 0,
    console_refresh_token: '',
  });
  if (!endpoint) return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  return NextResponse.json({ id, ...getQuotaAuthorization(endpoint) });
}
