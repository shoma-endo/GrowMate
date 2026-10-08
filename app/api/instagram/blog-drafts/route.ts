import { after, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { instagramBlogDraftJobService, InstagramBlogDraftBatchActiveError } from '@/server/services/instagramBlogDraftJobService';
import { startInstagramBlogDraftSchema } from '@/server/schemas/instagram-blog-draft.schema';

export async function POST(request: Request) {
  const auth = await authMiddleware();
  if (auth.error || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = auth.userDetails?.role;
  if (!role || !canAccessInstagram(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const parsed = startInstagramBlogDraftSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  try {
    const result = await instagramBlogDraftJobService.start(auth.userId, parsed.data.instagramMediaIds);
    if (result.batchId) {
      const batchId = result.batchId;
      after(() => instagramBlogDraftJobService.runBatch(batchId, auth.userId, role));
    }
    const responseBody = {
      started: result.started,
      resumed: result.resumed,
      excluded: result.excluded,
    };
    if (result.started + result.resumed === 0) {
      return NextResponse.json({ success: false, ...responseBody }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...responseBody }, { status: 200 });
  } catch (error) {
    if (error instanceof InstagramBlogDraftBatchActiveError) {
      return NextResponse.json({ error: 'Active batch exists' }, { status: 409 });
    }
    console.error('[Instagram BlogDraft] start failed', { userId: auth.userId, error });
    return NextResponse.json({ error: 'Failed to start blog draft' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;
