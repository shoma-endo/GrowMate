import { NextRequest, NextResponse } from 'next/server';
import { fetchGa4KeyEvents } from '@/server/actions/ga4Setup.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

async function handleKeyEvents(propertyId: string | null) {
  if (!propertyId) {
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.GA4.PROPERTY_ID_REQUIRED },
      { status: 400 }
    );
  }

  try {
    const result = await fetchGa4KeyEvents(propertyId);
    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    }

    if ('needsReauth' in result && result.needsReauth) {
      return NextResponse.json(result, { status: 401 });
    }

    if (
      result.error === ERROR_MESSAGES.AUTH.USER_AUTH_FAILED ||
      result.error === ERROR_MESSAGES.AUTH.AUTHENTICATION_FAILED ||
      result.error === ERROR_MESSAGES.AUTH.REAUTHENTICATION_REQUIRED
    ) {
      return NextResponse.json(result, { status: 401 });
    }

    if (
      result.error === ERROR_MESSAGES.AUTH.STAFF_OPERATION_NOT_ALLOWED ||
      result.error === ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED ||
      result.error === ERROR_MESSAGES.AUTH.UNAUTHORIZED
    ) {
      return NextResponse.json(result, { status: 403 });
    }

    return NextResponse.json(result, { status: 400 });
  } catch (error) {
    console.error('Failed to fetch GA4 key events:', error);
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.COMMON.SERVER_ERROR },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return handleKeyEvents(searchParams.get('propertyId'));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return handleKeyEvents(body?.propertyId ?? null);
}
