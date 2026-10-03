import { after, NextResponse } from 'next/server';
import { continueInstagramBlogDraftSchema } from '@/server/schemas/instagram-blog-draft.schema';
import { instagramBlogDraftJobService } from '@/server/services/instagramBlogDraftJobService';

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const parsed = continueInstagramBlogDraftSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  try {
    const continuation = await instagramBlogDraftJobService.authorizeContinuation(parsed.data.batchId);
    if (continuation) {
      after(() => instagramBlogDraftJobService.runBatch(
        parsed.data.batchId,
        continuation.userId,
        continuation.userRole
      ));
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Instagram BlogDraft] continuation failed', { batchId: parsed.data.batchId, error });
    return NextResponse.json({ error: 'Continuation failed' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;
