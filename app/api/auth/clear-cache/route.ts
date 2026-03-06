import { NextResponse } from 'next/server';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

// シンプルなキャッシュクリア通知のためのAPI
export async function POST() {
  try {
    return NextResponse.json({ success: true, message: ERROR_MESSAGES.COMMON.CACHE_CLEAR_SENT });
  } catch (error) {
    console.error('Cache clear API error:', error);
    return NextResponse.json({ error: ERROR_MESSAGES.COMMON.SERVER_ERROR }, { status: 500 });
  }
}