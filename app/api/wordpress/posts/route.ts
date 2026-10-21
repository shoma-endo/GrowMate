import { NextRequest, NextResponse } from 'next/server';
import { resolveWordPressContext } from '@/server/services/wordpressContext';
import { normalizeWordPressRestPosts } from '@/server/services/wordpressService';
import type { WordPressRestPost, WordPressNormalizedPost } from '@/types/wordpress';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

type ApiWordPressPost = Omit<WordPressNormalizedPost, 'canonical_url'>;

export async function GET(request: NextRequest) {
  try {
    const context = await resolveWordPressContext(name => request.cookies.get(name)?.value);

    if (!context.success) {
      if (context.reason === 'settings_missing') {
        return NextResponse.json({ success: true, data: { posts: [], total: 0 } });
      }

      return NextResponse.json(
        { success: false, error: context.message },
        { status: context.status }
      );
    }

    // ページネーション
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '20', 10), 100);

    const resp = await context.service.fetchRestPath(`posts?_embed=true&per_page=${perPage}&page=${page}`);

    if (!resp.ok) {
      return NextResponse.json(
        { success: false, error: ERROR_MESSAGES.WORDPRESS.POSTS_FETCH_FAILED },
        { status: 502 }
      );
    }

    const postsJson: unknown = await resp.json();
    const posts: WordPressRestPost[] = Array.isArray(postsJson)
      ? (postsJson as WordPressRestPost[])
      : [];
    const total = parseInt(resp.headers.get('X-WP-Total') || '0', 10);

    const normalizedRaw = normalizeWordPressRestPosts(posts);
    const normalized: ApiWordPressPost[] = normalizedRaw.map(post => {
      const { canonical_url, ...rest } = post;
      void canonical_url;
      return rest;
    });

    return NextResponse.json({ success: true, data: { posts: normalized, total } });
  } catch (error) {
    console.error('WP posts API error:', error);
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.WORDPRESS.SERVER_ERROR },
      { status: 500 }
    );
  }
}
