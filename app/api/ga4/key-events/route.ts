import { NextRequest, NextResponse } from 'next/server';
import { fetchGa4KeyEvents } from '@/server/actions/ga4Setup.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get('propertyId');

  if (!propertyId) {
    return NextResponse.json(
      { success: false, error: 'propertyId is required' },
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
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
