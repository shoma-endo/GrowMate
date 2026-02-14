import { NextResponse } from 'next/server';
import { fetchGa4Properties } from '@/server/actions/ga4Setup.actions';

export async function GET() {
  const result = await fetchGa4Properties();
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
