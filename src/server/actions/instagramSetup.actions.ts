'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { isInstagramReauthError } from '@/domain/errors/instagram-error-handlers';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { toInstagramConnectionStatus } from '@/server/lib/instagram-status';
import { SupabaseService } from '@/server/services/supabaseService';
import { InstagramService } from '@/server/services/instagramService';
import {
  createInstagramTokenDeps,
  ensureValidInstagramToken,
} from '@/server/services/instagramTokenService';
import type { ServerActionResult } from '@/lib/async-handler';
import type {
  InstagramConnectionStatus,
  InstagramMediaInsights,
  InstagramMediaPreview,
  InstagramPreviewData,
  InstagramProfile,
} from '@/types/instagram';
import type { UserRole } from '@/types/user';

const supabaseService = new SupabaseService();
const instagramService = new InstagramService();
const PREVIEW_MEDIA_LIMIT = 3;

const EMPTY_MEDIA_INSIGHTS: InstagramMediaInsights = {
  reach: null,
  views: null,
  likes: null,
  comments: null,
  saved: null,
  shares: null,
  totalInteractions: null,
  avgWatchTimeMs: null,
  totalWatchTimeMs: null,
};

interface AuthSuccess {
  userId: string;
  role: UserRole | null;
  error?: undefined;
}

interface AuthFailure {
  error: string;
  userId?: undefined;
  role?: undefined;
}

type AuthResult = AuthSuccess | AuthFailure;

const getAuthUserId = async (): Promise<AuthResult> => {
  const authResult = await authMiddleware();
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) return linkConflict;
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  return {
    userId: authResult.userId,
    role: authResult.userDetails?.role ?? null,
  };
};

const ensureInstagramAccess = async (): Promise<AuthResult | { error: string }> => {
  const authResult = await getAuthUserId();
  if ('error' in authResult) {
    return authResult;
  }
  if (!canAccessInstagram({ userId: authResult.userId, role: authResult.role })) {
    return { error: ERROR_MESSAGES.INSTAGRAM.ACCESS_DENIED };
  }
  return authResult;
};

export async function getInstagramConnectionStatus(): Promise<
  ServerActionResult<InstagramConnectionStatus>
> {
  try {
    const accessResult = await ensureInstagramAccess();
    if ('error' in accessResult && !('userId' in accessResult)) {
      return { success: false, error: accessResult.error };
    }
    const { userId } = accessResult as AuthSuccess;

    const useMockInstagram = process.env.NODE_ENV === 'development';
    let status: InstagramConnectionStatus;

    if (useMockInstagram) {
      status = DEV_SAMPLE_INSTAGRAM_STATUS;
    } else {
      const credential = await supabaseService.getInstagramCredential(userId);
      status = toInstagramConnectionStatus(credential);
    }

    return { success: true, data: status };
  } catch (error) {
    console.error('[Instagram Setup] getInstagramConnectionStatus failed', error);
    return { success: false, error: ERROR_MESSAGES.INSTAGRAM.STATUS_FETCH_FAILED };
  }
}

export async function disconnectInstagram(): Promise<ServerActionResult<void>> {
  try {
    const accessResult = await ensureInstagramAccess();
    if ('error' in accessResult && !('userId' in accessResult)) {
      return { success: false, error: accessResult.error };
    }
    const { userId } = accessResult as AuthSuccess;

    const deleteResult = await supabaseService.deleteInstagramCredential(userId);
    if (!deleteResult.success) {
      return { success: false, error: ERROR_MESSAGES.INSTAGRAM.DISCONNECT_FAILED };
    }

    revalidatePath('/setup');
    revalidatePath('/setup/instagram');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('[Instagram Setup] disconnectInstagram failed', error);
    return { success: false, error: ERROR_MESSAGES.INSTAGRAM.DISCONNECT_FAILED };
  }
}

export async function fetchInstagramPreviewData(): Promise<
  ServerActionResult<InstagramPreviewData> & { needsReauth?: boolean }
> {
  try {
    const accessResult = await ensureInstagramAccess();
    if ('error' in accessResult && !('userId' in accessResult)) {
      return { success: false, error: accessResult.error };
    }
    const { userId } = accessResult as AuthSuccess;

    const useMockInstagram = process.env.NODE_ENV === 'development';
    let preview: InstagramPreviewData;

    if (useMockInstagram) {
      preview = {
        profile: DEV_SAMPLE_INSTAGRAM_PROFILE,
        media: DEV_SAMPLE_INSTAGRAM_MEDIA,
        ...(DEV_SAMPLE_INSTAGRAM_FAILED_COUNT > 0
          ? { failedCount: DEV_SAMPLE_INSTAGRAM_FAILED_COUNT }
          : {}),
      };
    } else {
      const credential = await supabaseService.getInstagramCredential(userId);
      if (!credential) {
        return { success: false, error: ERROR_MESSAGES.INSTAGRAM.CONNECTION_FAILED };
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
            throw new Error(updateResult.error.developerMessage ?? 'Token persist failed');
          }
        })
      );

      if (tokenResult.needsReauth) {
        return {
          success: false,
          error: ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED,
          needsReauth: true,
        };
      }

      let profile: InstagramProfile;
      try {
        profile = await instagramService.fetchProfile(tokenResult.accessToken);
      } catch (error) {
        console.error('[Instagram Setup] fetchProfile failed', error);
        if (isInstagramReauthError(error)) {
          return {
            success: false,
            error: ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED,
            needsReauth: true,
          };
        }
        return { success: false, error: ERROR_MESSAGES.INSTAGRAM.PREVIEW_FETCH_FAILED };
      }

      const mediaItems = await instagramService.fetchMedia(
        tokenResult.accessToken,
        PREVIEW_MEDIA_LIMIT
      );
      const sortedMedia = [...mediaItems].sort((a, b) => {
        const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return bTime - aTime;
      });
      const targetMedia = sortedMedia.slice(0, PREVIEW_MEDIA_LIMIT);

      const media: InstagramMediaPreview[] = [];
      let failedCount = 0;

      for (const item of targetMedia) {
        try {
          const insights = await instagramService.fetchMediaInsights(
            tokenResult.accessToken,
            item.id,
            item.media_product_type === 'REELS' ? 'REELS' : 'FEED'
          );
          media.push(instagramService.toMediaPreview(item, insights));
        } catch (error) {
          if (isInstagramReauthError(error)) {
            return {
              success: false,
              error: ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED,
              needsReauth: true,
            };
          }
          failedCount += 1;
          console.error('[Instagram Setup] fetchMediaInsights failed', { mediaId: item.id, error });
          media.push(instagramService.toMediaPreview(item, EMPTY_MEDIA_INSIGHTS));
        }
      }

      await supabaseService.updateInstagramCredential(userId, {
        username: profile.username,
        accountType: profile.accountType,
        profilePictureUrl: profile.profilePictureUrl,
      });

      preview = {
        profile,
        media,
        ...(failedCount > 0 ? { failedCount } : {}),
      };
    }

    return { success: true, data: preview };
  } catch (error) {
    console.error('[Instagram Setup] fetchInstagramPreviewData failed', error);
    if (isInstagramReauthError(error)) {
      return {
        success: false,
        error: ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED,
        needsReauth: true,
      };
    }
    return { success: false, error: ERROR_MESSAGES.INSTAGRAM.PREVIEW_FETCH_FAILED };
  }
}

const DEV_SAMPLE_INSTAGRAM_STATUS: InstagramConnectionStatus = {
  connected: true,
  needsReauth: false,
  username: 'growmate_demo',
};

const DEV_SAMPLE_INSTAGRAM_PROFILE: InstagramProfile = {
  igUserId: '17841400000000000',
  username: 'growmate_demo',
  name: 'GrowMate Demo',
  accountType: 'BUSINESS',
  profilePictureUrl: null,
  followersCount: 1234,
  followsCount: 56,
  mediaCount: 78,
};

const DEV_SAMPLE_INSTAGRAM_MEDIA: InstagramMediaPreview[] = [
  {
    id: 'media-1',
    mediaType: 'VIDEO',
    mediaProductType: 'REELS',
    mediaUrl: null,
    thumbnailUrl: null,
    caption: '養鶏を始めて3ヶ月。毎朝の収穫が楽しみです。',
    timestamp: '2026-07-20T09:00:00+0000',
    permalink: 'https://www.instagram.com/reel/demo1/',
    likeCount: 120,
    commentsCount: 8,
    insights: {
      reach: 5200,
      views: 12000,
      likes: 120,
      comments: 8,
      saved: 320,
      shares: 45,
      totalInteractions: 493,
      avgWatchTimeMs: 8500,
      totalWatchTimeMs: 102000000,
    },
  },
  {
    id: 'media-2',
    mediaType: 'IMAGE',
    mediaProductType: 'FEED',
    mediaUrl: null,
    thumbnailUrl: null,
    caption: '卵かけご飯の朝ごはん。',
    timestamp: '2026-07-18T12:00:00+0000',
    permalink: 'https://www.instagram.com/p/demo2/',
    likeCount: 45,
    commentsCount: 3,
    insights: {
      reach: 1100,
      views: null,
      likes: 45,
      comments: 3,
      saved: 12,
      shares: 2,
      totalInteractions: 62,
      avgWatchTimeMs: null,
      totalWatchTimeMs: null,
    },
  },
  {
    id: 'media-3',
    mediaType: 'VIDEO',
    mediaProductType: 'REELS',
    mediaUrl: null,
    thumbnailUrl: null,
    caption: '鶏舎の日常。',
    timestamp: '2026-07-15T08:30:00+0000',
    permalink: 'https://www.instagram.com/reel/demo3/',
    likeCount: 89,
    commentsCount: 5,
    insights: {
      reach: 890,
      views: 2300,
      likes: 89,
      comments: 5,
      saved: 80,
      shares: 10,
      totalInteractions: 184,
      avgWatchTimeMs: 6200,
      totalWatchTimeMs: 14260000,
    },
  },
];

const DEV_SAMPLE_INSTAGRAM_FAILED_COUNT = 0;
