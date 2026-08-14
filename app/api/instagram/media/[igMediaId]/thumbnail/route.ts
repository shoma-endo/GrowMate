import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { isInstagramSyncEnabled } from '@/server/lib/instagram-sync-config';
import { fetchWithTimeout } from '@/server/lib/fetch-with-timeout';
import { instagramMediaService } from '@/server/services/instagramMediaService';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  createInstagramTokenDeps,
  ensureValidInstagramToken,
} from '@/server/services/instagramTokenService';
import { InstagramService } from '@/server/services/instagramService';
import { INSTAGRAM_CDN_HOSTS } from '@/lib/constants';

const supabaseService = new SupabaseService();
const instagramService = new InstagramService();

// proxy.ts の buildCspHeader（img-src）と同じ許可範囲（INSTAGRAM_CDN_HOSTS 共有）。
// ダウンロード元は必ずこのいずれかでなければならない。DB や Meta API のレスポンスを
// 無条件に信用して任意URLへ fetch すると SSRF になるため、ダウンロード直前に必ずこのチェックを通す。
const ALLOWED_IMAGE_HOSTS = INSTAGRAM_CDN_HOSTS.map(
  host => new RegExp(`(^|\\.)${host.replace(/\./g, '\\.')}$`)
);

function isAllowedImageHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_IMAGE_HOSTS.some(pattern => pattern.test(hostname));
  } catch {
    return false;
  }
}

// docs/plans/instagram-media-url-refresh-design.md §4
//
// 一覧画面（app/analytics）のサムネイルはこの Route Handler 経由でのみ表示する。
// キャッシュ済みなら Storage から即返し、未キャッシュなら Meta から一度だけ再取得して
// Storage へキャッシュしてから返す。以後は二度と Meta を呼ばない。
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ igMediaId: string }> }
) {
  const { igMediaId } = await params;
  if (!igMediaId) {
    return new NextResponse(null, { status: 404 });
  }

  const authResult = await authMiddleware();
  if (authResult.error || !authResult.userId) {
    return new NextResponse(null, { status: 401 });
  }
  if (!canAccessInstagram(authResult.userDetails?.role ?? null)) {
    return new NextResponse(null, { status: 403 });
  }
  const userId = authResult.userId;

  // DB エラー等の予期しない例外も含め、失敗経路は必ず 404（プレースホルダー）に落とす。
  // 一覧は投稿件数分このルートを叩くため、素の 500 を漏らすと1回の一時的な障害で
  // 表示中の全サムネイルが壊れて見える（design doc §6 の「いずれかの段階で失敗 → 404」）。
  try {
    return await resolveThumbnail(userId, igMediaId);
  } catch (error) {
    console.error('[Instagram Thumbnail] unexpected error', { userId, igMediaId, error });
    return new NextResponse(null, { status: 404 });
  }
}

async function resolveThumbnail(userId: string, igMediaId: string): Promise<NextResponse> {
  const media = await instagramMediaService.getMediaForThumbnail(userId, igMediaId);
  if (!media) {
    return new NextResponse(null, { status: 404 });
  }

  if (media.cachedThumbnailPath) {
    const cached = await instagramMediaService.downloadCachedThumbnail(media.cachedThumbnailPath);
    if (cached) {
      return imageResponse(cached, cached.type || 'image/jpeg');
    }
    // Storage 上のオブジェクトが何らかの理由で読めない場合は未キャッシュ扱いにフォールスルーする。
  }

  if (!isInstagramSyncEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  // DB に保存済みの URL（同期直後でまだ失効していない可能性がある）をまず直接試す。
  // 失敗（失効・削除済み等）した場合のみ Meta へ最新の URL を問い合わせる。
  const dbCandidate = pickCandidate(media);
  let downloaded = dbCandidate ? await downloadImage(dbCandidate) : null;
  if (!downloaded) {
    const freshUrls = await fetchFreshUrls(userId, igMediaId);
    const freshCandidate = freshUrls ? pickCandidate({ ...media, ...freshUrls }) : null;
    downloaded = freshCandidate ? await downloadImage(freshCandidate) : null;
  }
  if (!downloaded) {
    return new NextResponse(null, { status: 404 });
  }

  // cacheThumbnail が失敗しても（Storage保存不可等）、取得できたバイト自体は返す
  // （表示は成立させる。次回アクセス時に再度キャッシュ生成を試みる）。
  await instagramMediaService.cacheThumbnail(
    userId,
    igMediaId,
    downloaded.bytes,
    downloaded.contentType
  );
  return imageResponse(downloaded.bytes, downloaded.contentType);
}

function imageResponse(bytes: Blob, contentType: string): NextResponse {
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // private 必須: セッション認可に基づくレスポンスを共有 CDN/プロキシにキャッシュさせない。
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}

// Meta 公式: thumbnail_url は VIDEO (REELS) media でのみ利用可能。
// REELS の media_url は動画本体のため、thumbnail_url が無い場合はキャッシュ対象なし
// （動画バイトはキャッシュしない。docs/plans/instagram-media-url-refresh-design.md §4.4）。
function pickCandidate(media: {
  mediaProductType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
}): string | null {
  if (media.thumbnailUrl) {
    return media.thumbnailUrl;
  }
  if (media.mediaProductType === 'REELS') {
    return null;
  }
  return media.mediaUrl;
}

async function fetchFreshUrls(
  userId: string,
  igMediaId: string
): Promise<{ mediaUrl: string | null; thumbnailUrl: string | null } | null> {
  const credential = await supabaseService.getInstagramCredential(userId);
  if (!credential) {
    return null;
  }

  const tokenResult = await ensureValidInstagramToken(
    credential,
    createInstagramTokenDeps(userId, async payload => {
      const updateResult = await supabaseService.updateInstagramCredential(userId, {
        accessToken: payload.accessToken,
        accessTokenExpiresAt: payload.accessTokenExpiresAt,
        accessTokenIssuedAt: payload.accessTokenIssuedAt,
      });
      if (!updateResult.success) {
        // instagramSetup.actions.ts の同型コールバックと揃え、永続化失敗を必ずログに残す。
        // throw すると GET の try/catch まで伝播して 404 に落ちる（この1回はリフレッシュ後の
        // トークンで処理を続けたいところだが、未保存のまま握りつぶすと次回以降も
        // サイレントに再リフレッシュが走り続け、原因追跡ができなくなるほうが害が大きい）。
        console.error('[Instagram Thumbnail] token persist failed', {
          userId,
          error: updateResult.error,
        });
        throw new Error(updateResult.error.developerMessage ?? 'Token persist failed');
      }
    })
  );
  if (tokenResult.needsReauth) {
    return null;
  }

  try {
    const result = await instagramService.fetchMediaUrl(tokenResult.accessToken, igMediaId);
    return result.data;
  } catch (error) {
    console.error('[Instagram Thumbnail] fetchMediaUrl failed', { userId, igMediaId, error });
    return null;
  }
}

async function downloadImage(
  url: string
): Promise<{ bytes: Blob; contentType: string } | null> {
  if (!isAllowedImageHost(url)) {
    console.error('[Instagram Thumbnail] blocked non-CDN host', { url });
    return null;
  }

  try {
    const response = await fetchWithTimeout(url, {});
    if (!response.ok) {
      console.error('[Instagram Thumbnail] source image fetch failed', { status: response.status });
      return null;
    }
    const bytes = await response.blob();
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    return { bytes, contentType };
  } catch (error) {
    console.error('[Instagram Thumbnail] source image download failed', { error });
    return null;
  }
}
