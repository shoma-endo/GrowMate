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
import type { InstagramMediaPageResponse } from '@/server/lib/instagram-media-pagination';
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
import type { InstagramSyncMode, InstagramSyncResult, InstagramSyncStoppedReason } from '@/types/instagram';
import type { TablesInsert } from '@/types/database.types';

type InstagramMediaInsertRow = TablesInsert<'instagram_media'>;

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

/**
 * 差分同期（incremental）用。rawItems（新しい順）のうち、posted_at がウォーターマーク
 * （DB内の既存最新投稿日時）以下になる最初の index を返す。そこから先は同期済みとみなして
 * 打ち切る。該当する要素が無ければ -1（このページは全件がウォーターマークより新しい）。
 */
function findWatermarkCutIndex(rawItems: unknown[], watermarkPostedAt: string | null): number {
  if (!watermarkPostedAt) {
    return -1;
  }
  const watermarkMs = new Date(watermarkPostedAt).getTime();
  if (Number.isNaN(watermarkMs)) {
    return -1;
  }
  for (let i = 0; i < rawItems.length; i += 1) {
    const item = rawItems[i];
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const timestamp = (item as Record<string, unknown>).timestamp;
    if (typeof timestamp !== 'string') {
      continue;
    }
    const itemMs = new Date(timestamp).getTime();
    if (Number.isNaN(itemMs)) {
      continue;
    }
    if (itemMs <= watermarkMs) {
      return i;
    }
  }
  return -1;
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

  async syncUserData(
    userId: string,
    accessToken: string,
    mode: InstagramSyncMode
  ): Promise<InstagramSyncResult> {
    const startedAt = Date.now();
    let usage: InstagramRateUsage = emptyInstagramRateUsage;

    const result: InstagramSyncResult = {
      mode,
      synced: 0,
      failed: 0,
      skipped: 0,
      truncated: false,
      preConversionCount: 0,
      backfillCompleted: false,
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

    // backfill は永続化したカーソルから再開する。既に末端まで取り込み済みなら API を叩かず即返す。
    // incremental は常に after=null（最新から）で、DB内最新 posted_at をウォーターマークに使う。
    let cursor: string | null = null;
    let watermarkPostedAt: string | null = null;

    if (mode === 'backfill') {
      const credential = await this.supabaseService.getInstagramCredential(userId);
      if (credential?.backfillCompletedAt) {
        result.backfillCompleted = true;
        return result;
      }
      cursor = credential?.backfillCursor ?? null;
    } else {
      watermarkPostedAt = await instagramMediaService.getLatestPostedAt(userId);
    }

    let reachedEnd = false;
    let batchCount = 0;
    // incremental はウォーターマークで自然に1バッチ内に収まる設計のため複数バッチ化しない
    // （新着が INSTAGRAM_SYNC_MEDIA_LIMIT 件を超えて取りこぼした分は backfill に委ねる。
    // §4 Phase2 item3「新着51件超のエッジケース」）。
    // backfill は時間予算いっぱいまでバッチを繰り返し、wordpress-import / gsc-import と同様
    // 「1回のボタン操作でサーバー側が可能な限り処理して結果を返す」設計にする（クライアント側で
    // 複数回 Server Action を呼び直さなくてよい）。上限はランナウェイ防止の安全弁。
    const maxBatches = mode === 'backfill' ? 100 : 1;

    while (batchCount < maxBatches) {
      batchCount += 1;
      // このバッチの処理（インサイト取得）が完了しなかった場合に巻き戻す位置。
      // ページング取得だけ進めてインサイト取得が未完了のまま cursor を進めてしまうと、
      // 未処理分が次回 backfill で二度と取得されなくなる（バッチ内で fetch 済み・未 sync の
      // 投稿が永久にスキップされるデータロス）。中断時は必ずこの値まで戻す。
      const batchStartCursor = cursor;

      // --- 1バッチ分のページング取得フェーズ（最大 INSTAGRAM_SYNC_MEDIA_LIMIT 件） ---
      const pages: InstagramMediaPageResponse[] = [];

      while (pages.length < 20) {
        const budgetStop = checkBudget();
        if (budgetStop) {
          result.stoppedReason = budgetStop;
          break;
        }

        // 既にバッチ内に集まっている件数を踏まえ、残り枠ちょうどを要求する。
        // 固定 25 件のまま要求すると、Graph API が返すページが残り枠をまたいで
        // 「ページ内で打ち切り」になり得る（collectInstagramMediaPages の
        // mid-page truncation 分岐）。その場合カーソルはページ全体の後を指し、
        // 実際に採用しなかった分の投稿が永久にスキップされる。残り枠以下しか
        // 要求しなければこの分岐自体に到達しない。
        const alreadyCollected = collectInstagramMediaPages(pages, INSTAGRAM_SYNC_MEDIA_LIMIT);
        const remaining = INSTAGRAM_SYNC_MEDIA_LIMIT - alreadyCollected.items.length;
        if (remaining <= 0) {
          break;
        }
        const pageLimit = Math.min(25, remaining);
        const pageResult = await this.instagramService.fetchMediaPage(accessToken, {
          limit: pageLimit,
          after: cursor,
        });
        usage = mergeInstagramRateUsage(usage, pageResult.usage);

        if (mode === 'incremental' && watermarkPostedAt) {
          const rawItems = Array.isArray(pageResult.data.data) ? pageResult.data.data : [];
          const cutIndex = findWatermarkCutIndex(rawItems, watermarkPostedAt);
          if (cutIndex !== -1) {
            pages.push({ data: rawItems.slice(0, cutIndex), paging: pageResult.data.paging });
            break;
          }
        }

        pages.push(pageResult.data);

        const collected = collectInstagramMediaPages(pages, INSTAGRAM_SYNC_MEDIA_LIMIT);
        if (collected.truncated) {
          // このバッチは件数上限で区切られただけ（backfill は次バッチに続く）。
          result.truncated = true;
          console.warn('[Instagram Sync]', {
            truncated: true,
            limit: INSTAGRAM_SYNC_MEDIA_LIMIT,
            mode,
            batchCount,
          });
          break;
        }

        if (!collected.nextCursor) {
          reachedEnd = true;
          break;
        }
        cursor = collected.nextCursor;

        if (collected.items.length >= INSTAGRAM_SYNC_MEDIA_LIMIT) {
          // ちょうど上限に達した。次ページを取りに行くと丸ごと破棄される
          // だけの無駄な API コールになる（レート/時間予算を浪費し、結果的に
          // 中断が起きやすくなる）ため、ここで打ち切る。
          break;
        }
      }

      const collected = collectInstagramMediaPages(pages, INSTAGRAM_SYNC_MEDIA_LIMIT);
      result.skipped += countUnsupportedMediaFromRaw(collected.items);
      let parsedItems = parseInstagramMediaItems(collected.items, { logUnsupported: false });

      // backfill は既存投稿のインサイトを再取得しない（レート消費を新規分に温存する）。
      // skipped（非対応 media_product_type 用の既存カウンタ）には加算しない。
      if (mode === 'backfill') {
        const existingIds = await instagramMediaService.getExistingMediaIds(
          userId,
          parsedItems.map(item => item.id)
        );
        parsedItems = parsedItems.filter(item => !existingIds.has(item.id));
      }

      if (parsedItems.length > 0) {
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
      }

      if (!result.stoppedReason) {
        const budgetStop = checkBudget();
        if (budgetStop) {
          result.stoppedReason = budgetStop;
        }
      }

      if (mode === 'backfill' && result.stoppedReason) {
        // ページング取得は完了・進行していても、このバッチのインサイト取得
        // （アイテム処理ループ）が中断された場合は cursor をバッチ開始位置へ
        // 巻き戻す。次回はこのバッチを丸ごと再取得するが、getExistingMediaIds
        // により既に sync 済みの投稿はスキップされるため、未処理分だけが
        // 再試行される（cursor を進めたまま保存すると、未処理分が永久に
        // スキップされてしまう）。
        cursor = batchStartCursor;
      }

      // incremental は常に1バッチで終了。backfill は末端到達 or 中断まで次バッチへ進む。
      if (mode === 'incremental') {
        break;
      }
      if (reachedEnd || result.stoppedReason) {
        break;
      }
    }

    // backfill の進捗永続化。lastSyncedAt / account insights daily の更新は「新着を拾う」
    // incremental の意味に紐づく処理のため、backfill 実行時は行わない
    // （ユーザー向け「まだデータがありません」判定に backfill の裏側実行を混ぜない）。
    if (mode === 'backfill') {
      // reachedEnd は「ページング取得がアカウント末端に達したか」のみを示す。
      // 末端に達していても、そのバッチのインサイト取得が stoppedReason で中断していれば
      // 未処理の投稿が残っている状態なので、完了扱いにしてはいけない
      // （backfillCompletedAt をセットすると次回以降 API を叩かず即終了してしまい、
      // 未処理分が永久にスキップされる）。
      if (reachedEnd && !result.stoppedReason) {
        await this.supabaseService.updateInstagramCredential(userId, {
          backfillCompletedAt: new Date().toISOString(),
          backfillCursor: null,
        });
        result.backfillCompleted = true;
      } else {
        await this.supabaseService.updateInstagramCredential(userId, {
          backfillCursor: cursor,
        });
      }
    }

    if (mode === 'incremental' && result.stoppedReason !== 'rate_limit') {
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
      mode,
      batchCount,
      appUsage: usage.appUsage,
      bucUsage: usage.bucUsage,
      synced: result.synced,
      failed: result.failed,
    });

    if (mode === 'incremental') {
      await this.supabaseService.updateInstagramCredential(userId, {
        lastSyncedAt: new Date().toISOString(),
      });
    }

    return result;
  }
}

export const instagramSyncService = new InstagramSyncService();
