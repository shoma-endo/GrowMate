import { NextRequest, NextResponse } from 'next/server';
import { saveGa4Settings } from '@/server/actions/ga4Setup.actions';

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const result = await saveGa4Settings(body);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
