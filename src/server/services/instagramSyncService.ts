import 'server-only';
import { isInstagramPreConversionMediaError } from '@/domain/errors/instagram-error-handlers';
import { addDaysISO } from '@/lib/date-utils';
import {
  INSTAGRAM_RATE_CALL_COUNT_THRESHOLD,
  INSTAGRAM_SYNC_CONSECUTIVE_FAILURE_LIMIT,
  INSTAGRAM_SYNC_MEDIA_LIMIT,
  INSTAGRAM_SYNC_TIME_BUDGET_MS,
} from '@/lib/constants';
import { formatJstDateISO } from '@/lib/ga4-utils';
import { collectInstagramMediaPages } from '@/server/lib/instagram-media-pagination';
import { extractInstagramMediaAfterCursor } from '@/server/lib/instagram-media-pagination';
import {
  emptyInstagramRateUsage,
  hasExceededInstagramRateThreshold,
  mergeInstagramRateUsage,
  type InstagramRateUsage,
} from '@/server/lib/instagram-rate-limit';
import { instagramMediaService } from '@/server/services/instagramMediaService';
import type { InstagramMediaListingFields } from '@/server/services/instagramMediaService';
import {
  InstagramService,
  parseInstagramMediaItems,
} from '@/server/services/instagramService';
import { SupabaseService } from '@/server/services/supabaseService';
import type { InstagramSyncResult, InstagramSyncStoppedReason } from '@/types/instagram';
import type { InstagramMediaInsertRow } from '@/types/database.types.pending';

const MEDIA_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const ACCOUNT_INSIGHTS_LOOKBACK_DAYS = 30;

function unixTimestamp(dateIso: string): string {
  const ms = new Date(`${dateIso}T00:00:00.000Z`).getTime();
  return String(Math.floor(ms / 1000));
}

function resolveAccountInsightsRange(lastSyncedAt: string | null): { since: string; until: string } {
  const todayJst = formatJstDateISO(new Date());
  const until = addDaysISO(todayJst, -1);

  if (!lastSyncedAt) {
    const since = addDaysISO(until, -(ACCOUNT_INSIGHTS_LOOKBACK_DAYS - 1));
    return { since, until };
  }

  const lastDate = lastSyncedAt.slice(0, 10);
  const since = lastDate <= until ? lastDate : until;
  return { since, until };
}

function isRetentionExpired(postedAt: string, nowMs: number): boolean {
  const postedMs = new Date(postedAt).getTime();
  if (Number.isNaN(postedMs)) {
    return false;
  }
  return nowMs - postedMs > MEDIA_RETENTION_MS;
}

function buildMediaListingFields(
  item: ReturnType<typeof parseInstagramMediaItems>[number]
): InstagramMediaListingFields {
  if (!item.permalink || !item.timestamp) {
    throw new Error('Instagram media item missing permalink or timestamp');
  }
  return {
    igMediaId: item.id,
    mediaType: parseMediaTypeForDb(item.media_type),
    mediaProductType: item.media_product_type,
    caption: item.caption ?? null,
    mediaUrl: item.media_url ?? null,
    thumbnailUrl: item.thumbnail_url ?? null,
    permalink: item.permalink,
    postedAt: item.timestamp,
    likeCount: item.like_count ?? null,
    commentsCount: item.comments_count ?? null,
  };
}

function countUnsupportedMediaFromRaw(rawItems: unknown[]): number {
  let count = 0;
  for (const item of rawItems) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const rawType = record.media_product_type;
    if (rawType === 'FEED' || rawType === 'REELS') {
      continue;
    }
    if (typeof rawType === 'string' && rawType.length > 0) {
      count += 1;
      const mediaId = typeof record.id === 'string' ? record.id : '';
      console.warn('[Instagram Sync]', {
        skipped: true,
        reason: 'unsupported_product_type',
        media_product_type: rawType,
        mediaId,
      });
    }
  }
  return count;
}

function buildMediaRowWithInsights(
  userId: string,
  listing: InstagramMediaListingFields,
  insights: Awaited<
    ReturnType<InstagramService['fetchMediaInsights']>
  >['data'],
  insightsSyncedAt: string
): InstagramMediaInsertRow {
  return {
    user_id: userId,
    ig_media_id: listing.igMediaId,
    media_type: listing.mediaType,
    media_product_type: listing.mediaProductType,
    caption: listing.caption,
    media_url: listing.mediaUrl,
    thumbnail_url: listing.thumbnailUrl,
    permalink: listing.permalink,
    posted_at: listing.postedAt,
    like_count: insights.likes ?? listing.likeCount,
    comments_count: insights.comments ?? listing.commentsCount,
    reach: insights.reach,
    views: insights.views,
    saved: insights.saved,
    shares: insights.shares,
    total_interactions: insights.totalInteractions,
    reposts: insights.reposts,
    reels_skip_rate: insights.reelsSkipRate,
    avg_watch_time_ms: insights.avgWatchTimeMs,
    total_watch_time_ms: insights.totalWatchTimeMs,
    insights_synced_at: insightsSyncedAt,
    insights_unavailable: false,
    insights_unavailable_reason: null,
  };
}

function parseMediaTypeForDb(value: string | undefined): InstagramMediaInsertRow['media_type'] {
  if (value === 'VIDEO' || value === 'CAROUSEL_ALBUM') {
    return value;
  }
  return 'IMAGE';
}

class InstagramSyncService {
  private readonly instagramService = new InstagramService();
  private readonly supabaseService = new SupabaseService();

  async syncUserData(userId: string, accessToken: string): Promise<InstagramSyncResult> {
    const startedAt = Date.now();
    let usage: InstagramRateUsage = emptyInstagramRateUsage;

    const result: InstagramSyncResult = {
      synced: 0,
      failed: 0,
      skipped: 0,
      truncated: false,
      preConversionCount: 0,
    };

    const checkBudget = (): InstagramSyncStoppedReason | null => {
      if (Date.now() - startedAt >= INSTAGRAM_SYNC_TIME_BUDGET_MS) {
        return 'time_budget';
      }
      if (hasExceededInstagramRateThreshold(usage, INSTAGRAM_RATE_CALL_COUNT_THRESHOLD)) {
        return 'rate_limit';
      }
      return null;
    };

    let consecutiveFailures = 0;

    const pages = [];
    let after: string | null = null;

    while (pages.length < 20) {
      const budgetStop = checkBudget();
      if (budgetStop) {
        result.stoppedReason = budgetStop;
        break;
      }

      const pageLimit = Math.min(25, INSTAGRAM_SYNC_MEDIA_LIMIT);
      const pageResult = await this.instagramService.fetchMediaPage(accessToken, {
        limit: pageLimit,
        after,
      });
      usage = mergeInstagramRateUsage(usage, pageResult.usage);
      pages.push(pageResult.data);

      const collected = collectInstagramMediaPages(pages, INSTAGRAM_SYNC_MEDIA_LIMIT);
      if (collected.truncated) {
        result.truncated = true;
        console.warn('[Instagram Sync]', {
          truncated: true,
          limit: INSTAGRAM_SYNC_MEDIA_LIMIT,
        });
        break;
      }

      after = extractInstagramMediaAfterCursor(pageResult.data.paging);
      if (!after || collected.items.length >= INSTAGRAM_SYNC_MEDIA_LIMIT) {
        break;
      }
    }

    const collected = collectInstagramMediaPages(pages, INSTAGRAM_SYNC_MEDIA_LIMIT);
    result.truncated = result.truncated || collected.truncated;
    result.skipped += countUnsupportedMediaFromRaw(collected.items);
    const parsedItems = parseInstagramMediaItems(collected.items, { logUnsupported: false });

    const igMediaIds = parsedItems.map(item => item.id);
    const unavailableIds = await instagramMediaService.getInsightsUnavailableMediaIds(
      userId,
      igMediaIds
    );

    const nowMs = Date.now();

    for (const item of parsedItems) {
      const budgetStop = checkBudget();
      if (budgetStop) {
        result.stoppedReason = budgetStop;
        break;
      }

      if (consecutiveFailures >= INSTAGRAM_SYNC_CONSECUTIVE_FAILURE_LIMIT) {
        result.stoppedReason = 'consecutive_failures';
        break;
      }

      const listing = buildMediaListingFields(item);

      if (unavailableIds.has(item.id)) {
        try {
          await instagramMediaService.updateMediaListingFields(userId, listing);
        } catch (error) {
          result.failed += 1;
          consecutiveFailures += 1;
          console.error('[Instagram Sync] unavailable media listing update failed', {
            mediaId: item.id,
            error,
          });
        }
        continue;
      }

      try {
        const insightsResult = await this.instagramService.fetchMediaInsights(
          accessToken,
          item.id,
          item.media_product_type
        );
        usage = mergeInstagramRateUsage(usage, insightsResult.usage);
        const insights = insightsResult.data;
        const insightsSyncedAt = new Date().toISOString();

        await instagramMediaService.upsertMedia(
          userId,
          buildMediaRowWithInsights(userId, listing, insights, insightsSyncedAt)
        );

        result.synced += 1;
        consecutiveFailures = 0;
      } catch (error) {
        if (isInstagramPreConversionMediaError(error)) {
          result.preConversionCount += 1;
          await instagramMediaService.upsertMediaInsightsUnavailable(
            userId,
            listing,
            'pre_conversion'
          );
          consecutiveFailures = 0;
          continue;
        }

        if (isRetentionExpired(item.timestamp!, nowMs)) {
          await instagramMediaService.upsertMediaInsightsUnavailable(
            userId,
            listing,
            'retention_expired'
          );
          consecutiveFailures = 0;
          continue;
        }

        try {
          await instagramMediaService.upsertMediaListingPreservingInsights(userId, listing);
        } catch (listingError) {
          console.error('[Instagram Sync] listing preserve failed after insights error', {
            mediaId: item.id,
            listingError,
          });
        }

        result.failed += 1;
        consecutiveFailures += 1;
        console.error('[Instagram Sync] fetchMediaInsights failed', {
          mediaId: item.id,
          error,
        });
      }
    }

    if (!result.stoppedReason) {
      const budgetStop = checkBudget();
      if (budgetStop) {
        result.stoppedReason = budgetStop;
      }
    }

    if (result.stoppedReason !== 'rate_limit') {
      try {
        const credential = await this.supabaseService.getInstagramCredential(userId);
        const range = resolveAccountInsightsRange(credential?.lastSyncedAt ?? null);
        const rangeUnix = {
          since: unixTimestamp(range.since),
          until: unixTimestamp(range.until),
        };
        const accountResult = await this.instagramService.fetchAccountInsightsDaily(
          accessToken,
          rangeUnix
        );
        usage = mergeInstagramRateUsage(usage, accountResult.usage);

        await instagramMediaService.upsertAccountInsightsDaily(
          userId,
          accountResult.data.map(row => ({
            user_id: userId,
            date: row.date,
            reach: row.reach,
            follower_count: row.followerCount,
          }))
        );
      } catch (error) {
        console.error('[Instagram Sync] account insights sync failed', { userId, error });
      }
    }

    console.warn('[Instagram Sync]', {
      appUsage: usage.appUsage,
      bucUsage: usage.bucUsage,
      synced: result.synced,
      failed: result.failed,
    });

    await this.supabaseService.updateInstagramCredential(userId, {
      lastSyncedAt: new Date().toISOString(),
    });

    return result;
  }
}

export const instagramSyncService = new InstagramSyncService();
