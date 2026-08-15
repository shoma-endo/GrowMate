import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService, type SupabaseResult } from '@/server/services/supabaseService';
import { asPendingClient, type InstagramMediaDatabase } from '@/types/database.types.pending';
import type { Database, Tables, TablesInsert } from '@/types/database.types';
import { INSTAGRAM_MEDIA_THUMBNAIL_BUCKET } from '@/lib/constants';
import type {
  InstagramMediaListItem,
  InstagramMediaPageResult,
  InstagramMediaSortKey,
  InstagramMediaTypeFilter,
} from '@/types/instagram';

type InstagramMediaRow = Tables<'instagram_media'>;
type InstagramMediaInsertRow = TablesInsert<'instagram_media'>;

export type InstagramMediaListingFields = {
  igMediaId: string;
  mediaType: InstagramMediaInsertRow['media_type'];
  mediaProductType: InstagramMediaInsertRow['media_product_type'];
  caption: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string;
  postedAt: string;
  likeCount: number | null;
  commentsCount: number | null;
};

function assertScopedUserId(userId: string, rowUserId: string): void {
  if (rowUserId !== userId) {
    throw new Error('Instagram upsert user_id mismatch');
  }
}

function listingFieldsToInsertRow(
  userId: string,
  fields: InstagramMediaListingFields,
  insightState: {
    insightsUnavailable: boolean;
    insightsUnavailableReason: 'pre_conversion' | 'retention_expired' | null;
    insightsSyncedAt: string | null;
  }
): InstagramMediaInsertRow {
  // INSERT 経路は DB 上インサイト列がすべて必須（NOT NULL 制約はないが Insert 型が Partial ではない）。
  // 新規行は未取得状態として null で埋め、既存行の値は UPDATE 経路（呼び出し元の update 分岐）でのみ変更する。
  return {
    user_id: userId,
    ig_media_id: fields.igMediaId,
    media_type: fields.mediaType,
    media_product_type: fields.mediaProductType,
    caption: fields.caption,
    media_url: fields.mediaUrl,
    thumbnail_url: fields.thumbnailUrl,
    permalink: fields.permalink,
    posted_at: fields.postedAt,
    like_count: fields.likeCount,
    comments_count: fields.commentsCount,
    insights_unavailable: insightState.insightsUnavailable,
    insights_unavailable_reason: insightState.insightsUnavailableReason,
    insights_synced_at: insightState.insightsSyncedAt,
    reach: null,
    views: null,
    saved: null,
    shares: null,
    total_interactions: null,
    reposts: null,
    reels_skip_rate: null,
    avg_watch_time_ms: null,
    total_watch_time_ms: null,
  };
}

interface InstagramMediaQuery {
  page: number;
  perPage: number;
  type: InstagramMediaTypeFilter;
  startDate: string;
  endDate: string;
  sort: InstagramMediaSortKey;
}

function mapMediaRow(row: InstagramMediaRow): InstagramMediaListItem {
  const reason = row.insights_unavailable_reason;
  const unavailableReason: InstagramMediaListItem['insightsUnavailableReason'] =
    reason === 'pre_conversion' || reason === 'retention_expired' ? reason : null;

  return {
    id: row.id,
    igMediaId: row.ig_media_id,
    mediaType: row.media_type as InstagramMediaListItem['mediaType'],
    mediaProductType: row.media_product_type as InstagramMediaListItem['mediaProductType'],
    caption: row.caption,
    mediaUrl: row.media_url,
    thumbnailUrl: row.thumbnail_url,
    permalink: row.permalink,
    postedAt: row.posted_at,
    likeCount: row.like_count,
    commentsCount: row.comments_count,
    reach: row.reach,
    views: row.views,
    saved: row.saved,
    shares: row.shares,
    totalInteractions: row.total_interactions,
    reposts: row.reposts,
    reelsSkipRate: row.reels_skip_rate,
    avgWatchTimeMs: row.avg_watch_time_ms,
    totalWatchTimeMs: row.total_watch_time_ms,
    insightsSyncedAt: row.insights_synced_at,
    insightsUnavailable: row.insights_unavailable,
    insightsUnavailableReason: unavailableReason,
  };
}

class InstagramMediaService extends SupabaseService {
  async getPage(userId: string, query: InstagramMediaQuery): Promise<InstagramMediaPageResult> {
    const client = this.getClient();

    const runQuery = async (page: number) => {
      const offset = (page - 1) * query.perPage;
      let dbQuery = client
        .from('instagram_media')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .gte('posted_at', `${query.startDate}T00:00:00.000Z`)
        .lte('posted_at', `${query.endDate}T23:59:59.999Z`);

      if (query.type === 'reels') {
        dbQuery = dbQuery.eq('media_product_type', 'REELS');
      } else if (query.type === 'feed') {
        dbQuery = dbQuery.eq('media_product_type', 'FEED');
      }

      const ascending = false;
      if (query.sort === 'reach') {
        dbQuery = dbQuery.order('reach', { ascending, nullsFirst: false });
      } else if (query.sort === 'views') {
        dbQuery = dbQuery.order('views', { ascending, nullsFirst: false });
      } else {
        dbQuery = dbQuery.order('posted_at', { ascending });
      }

      dbQuery = dbQuery.order('id', { ascending: true }).range(offset, offset + query.perPage - 1);
      return dbQuery;
    };

    const { data, error, count } = await runQuery(query.page);
    if (error) {
      console.error('[Instagram Media] getPage failed', { userId, error });
      throw new Error('Instagram media fetch failed');
    }

    const total = count ?? 0;
    const totalPages = total > 0 ? Math.ceil(total / query.perPage) : 1;

    // URL 直接編集や絞り込み変更・削除後の古いページ番号など、要求ページが
    // 総ページ数を超えることがある。超過時は総ページ数へ丸めて取り直し、
    // 投稿があるのに空表示になったり「999/1ページ」のような壊れた表示を防ぐ。
    if (query.page > totalPages) {
      const { data: clampedData, error: clampedError } = await runQuery(totalPages);
      if (clampedError) {
        console.error('[Instagram Media] getPage clamped fetch failed', { userId, clampedError });
        throw new Error('Instagram media fetch failed');
      }
      return {
        items: (clampedData ?? []).map(mapMediaRow),
        total,
        totalPages,
        page: totalPages,
        perPage: query.perPage,
      };
    }

    return {
      items: (data ?? []).map(mapMediaRow),
      total,
      totalPages,
      page: query.page,
      perPage: query.perPage,
    };
  }


  async getInsightsUnavailableMediaIds(
    userId: string,
    igMediaIds: string[]
  ): Promise<Set<string>> {
    if (igMediaIds.length === 0) {
      return new Set();
    }
    const client = this.getClient();
    const { data, error } = await client
      .from('instagram_media')
      .select('ig_media_id')
      .eq('user_id', userId)
      .eq('insights_unavailable', true)
      .in('ig_media_id', igMediaIds);

    if (error) {
      console.error('[Instagram Media] getInsightsUnavailableMediaIds failed', { userId, error });
      throw new Error('Instagram unavailable media lookup failed');
    }

    return new Set((data ?? []).map(row => row.ig_media_id));
  }

  /** 差分同期（incremental）のウォーターマーク。DB内で最も新しい posted_at（無ければ null＝初回同期） */
  async getLatestPostedAt(userId: string): Promise<string | null> {
    const client = this.getClient();
    const { data, error } = await client
      .from('instagram_media')
      .select('posted_at')
      .eq('user_id', userId)
      .order('posted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Instagram Media] getLatestPostedAt failed', { userId, error });
      throw new Error('Instagram media latest posted_at fetch failed');
    }

    return data?.posted_at ?? null;
  }

  /** 過去投稿取り込み（backfill）用。指定 ig_media_id のうち既に DB にある ID 集合（インサイト再取得をスキップする対象） */
  async getExistingMediaIds(userId: string, igMediaIds: string[]): Promise<Set<string>> {
    if (igMediaIds.length === 0) {
      return new Set();
    }
    const client = this.getClient();
    const { data, error } = await client
      .from('instagram_media')
      .select('ig_media_id')
      .eq('user_id', userId)
      .in('ig_media_id', igMediaIds);

    if (error) {
      console.error('[Instagram Media] getExistingMediaIds failed', { userId, error });
      throw new Error('Instagram existing media lookup failed');
    }

    return new Set((data ?? []).map(row => row.ig_media_id));
  }

  async upsertMedia(userId: string, row: InstagramMediaInsertRow): Promise<void> {
    assertScopedUserId(userId, row.user_id);
    const scopedRow: InstagramMediaInsertRow = { ...row, user_id: userId };
    await SupabaseService.withServiceRoleClient(async client => {
      const { error } = await client
        .from('instagram_media')
        .upsert(scopedRow, { onConflict: 'user_id,ig_media_id' });
      if (error) {
        console.error('[Instagram Media] upsertMedia failed', { userId, error });
        throw new Error('Instagram media upsert failed');
      }
    });
  }

  /** insights 恒久不可行は指標・フラグを触らず、一覧メタデータ（CDN URL 等）のみ更新する */
  async updateMediaListingFields(
    userId: string,
    fields: InstagramMediaListingFields
  ): Promise<void> {
    await SupabaseService.withServiceRoleClient(async client => {
      const { error } = await client
        .from('instagram_media')
        .update({
          media_type: fields.mediaType,
          media_product_type: fields.mediaProductType,
          caption: fields.caption,
          media_url: fields.mediaUrl,
          thumbnail_url: fields.thumbnailUrl,
          permalink: fields.permalink,
          posted_at: fields.postedAt,
          like_count: fields.likeCount,
          comments_count: fields.commentsCount,
        })
        .eq('user_id', userId)
        .eq('ig_media_id', fields.igMediaId);
      if (error) {
        console.error('[Instagram Media] updateMediaListingFields failed', { userId, error });
        throw new Error('Instagram media listing update failed');
      }
    });
  }

  async upsertMediaInsightsUnavailable(
    userId: string,
    fields: InstagramMediaListingFields,
    reason: 'pre_conversion' | 'retention_expired'
  ): Promise<void> {
    await SupabaseService.withServiceRoleClient(async client => {
      const { data: existing, error: lookupError } = await client
        .from('instagram_media')
        .select('id')
        .eq('user_id', userId)
        .eq('ig_media_id', fields.igMediaId)
        .maybeSingle();

      if (lookupError) {
        console.error('[Instagram Media] upsertMediaInsightsUnavailable lookup failed', {
          userId,
          error: lookupError,
        });
        throw new Error('Instagram media unavailable lookup failed');
      }

      if (existing) {
        const { error } = await client
          .from('instagram_media')
          .update({
            media_type: fields.mediaType,
            media_product_type: fields.mediaProductType,
            caption: fields.caption,
            media_url: fields.mediaUrl,
            thumbnail_url: fields.thumbnailUrl,
            permalink: fields.permalink,
            posted_at: fields.postedAt,
            like_count: fields.likeCount,
            comments_count: fields.commentsCount,
            insights_unavailable: true,
            insights_unavailable_reason: reason,
          })
          .eq('user_id', userId)
          .eq('ig_media_id', fields.igMediaId);
        if (error) {
          console.error('[Instagram Media] upsertMediaInsightsUnavailable update failed', {
            userId,
            error,
          });
          throw new Error('Instagram media unavailable update failed');
        }
        return;
      }

      const row = listingFieldsToInsertRow(userId, fields, {
        insightsUnavailable: true,
        insightsUnavailableReason: reason,
        insightsSyncedAt: null,
      });
      const { error } = await client
        .from('instagram_media')
        .upsert(row, { onConflict: 'user_id,ig_media_id' });
      if (error) {
        console.error('[Instagram Media] upsertMediaInsightsUnavailable insert failed', {
          userId,
          error,
        });
        throw new Error('Instagram media unavailable insert failed');
      }
    });
  }

  /** insights 一時失敗時は既存指標を残し、一覧メタデータのみ反映する */
  async upsertMediaListingPreservingInsights(
    userId: string,
    fields: InstagramMediaListingFields
  ): Promise<void> {
    await SupabaseService.withServiceRoleClient(async client => {
      const { data: existing, error: lookupError } = await client
        .from('instagram_media')
        .select('id')
        .eq('user_id', userId)
        .eq('ig_media_id', fields.igMediaId)
        .maybeSingle();

      if (lookupError) {
        console.error('[Instagram Media] upsertMediaListingPreservingInsights lookup failed', {
          userId,
          error: lookupError,
        });
        throw new Error('Instagram media listing lookup failed');
      }

      if (existing) {
        const { error } = await client
          .from('instagram_media')
          .update({
            media_type: fields.mediaType,
            media_product_type: fields.mediaProductType,
            caption: fields.caption,
            media_url: fields.mediaUrl,
            thumbnail_url: fields.thumbnailUrl,
            permalink: fields.permalink,
            posted_at: fields.postedAt,
            like_count: fields.likeCount,
            comments_count: fields.commentsCount,
          })
          .eq('user_id', userId)
          .eq('ig_media_id', fields.igMediaId);
        if (error) {
          console.error('[Instagram Media] upsertMediaListingPreservingInsights update failed', {
            userId,
            error,
          });
          throw new Error('Instagram media listing update failed');
        }
        return;
      }

      const row = listingFieldsToInsertRow(userId, fields, {
        insightsUnavailable: false,
        insightsUnavailableReason: null,
        insightsSyncedAt: null,
      });
      const { error } = await client
        .from('instagram_media')
        .upsert(row, { onConflict: 'user_id,ig_media_id' });
      if (error) {
        console.error('[Instagram Media] upsertMediaListingPreservingInsights insert failed', {
          userId,
          error,
        });
        throw new Error('Instagram media listing insert failed');
      }
    });
  }


  /**
   * サムネイルキャッシュの表示に必要な最小フィールドを1件取得する。
   * docs/plans/instagram-media-url-refresh-design.md §4 の Route Handler から呼ばれる。
   */
  async getMediaForThumbnail(
    userId: string,
    igMediaId: string
  ): Promise<{
    mediaProductType: string;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
    cachedThumbnailPath: string | null;
  } | null> {
    return SupabaseService.withServiceRoleClient(async client => {
      const { data, error } = await asPendingClient<InstagramMediaDatabase>(client)
        .from('instagram_media')
        .select('media_product_type, media_url, thumbnail_url, cached_thumbnail_path')
        .eq('user_id', userId)
        .eq('ig_media_id', igMediaId)
        .maybeSingle();

      if (error) {
        console.error('[Instagram Media] getMediaForThumbnail failed', { userId, igMediaId, error });
        throw new Error('Instagram media thumbnail lookup failed');
      }
      if (!data) {
        return null;
      }

      return {
        mediaProductType: data.media_product_type,
        mediaUrl: data.media_url,
        thumbnailUrl: data.thumbnail_url,
        cachedThumbnailPath: data.cached_thumbnail_path,
      };
    });
  }

  /** Storage からキャッシュ済みサムネイル画像を取得する。無ければ null。 */
  async downloadCachedThumbnail(path: string): Promise<Blob | null> {
    return SupabaseService.withServiceRoleClient(async client => {
      const { data, error } = await client.storage
        .from(INSTAGRAM_MEDIA_THUMBNAIL_BUCKET)
        .download(path);
      if (error) {
        console.error('[Instagram Media] downloadCachedThumbnail failed', { path, error });
        return null;
      }
      return data;
    });
  }

  /**
   * 画像バイトを Storage へ保存し、instagram_media.cached_thumbnail_path を更新する。
   * 保存したパスを返す。失敗時は null（呼び出し元はキャッシュ無しとして扱い、次回アクセス時に再試行する）。
   */
  async cacheThumbnail(
    userId: string,
    igMediaId: string,
    bytes: Blob,
    contentType: string
  ): Promise<string | null> {
    const path = `${userId}/${igMediaId}.jpg`;
    return SupabaseService.withServiceRoleClient(
      async client => {
        const { error: uploadError } = await client.storage
          .from(INSTAGRAM_MEDIA_THUMBNAIL_BUCKET)
          .upload(path, bytes, { contentType, upsert: true });
        if (uploadError) {
          console.error('[Instagram Media] cacheThumbnail upload failed', {
            userId,
            igMediaId,
            uploadError,
          });
          return null;
        }

        const { error: updateError } = await asPendingClient<InstagramMediaDatabase>(client)
          .from('instagram_media')
          .update({ cached_thumbnail_path: path })
          .eq('user_id', userId)
          .eq('ig_media_id', igMediaId);
        if (updateError) {
          console.error('[Instagram Media] cacheThumbnail DB update failed', {
            userId,
            igMediaId,
            updateError,
          });
          return null;
        }

        return path;
      },
      { logMessage: null }
    );
  }

  /**
   * instagram_media 行を消す前に、対応する Storage オブジェクトを削除する
   * （行だけ消すとキャッシュ画像が孤児として残り続ける）。失敗は非致命的（ログのみ）。
   */
  private async purgeCachedThumbnails(
    client: SupabaseClient<Database>,
    userId: string
  ): Promise<void> {
    const { data: cachedObjects, error: listError } = await client.storage
      .from(INSTAGRAM_MEDIA_THUMBNAIL_BUCKET)
      .list(userId);
    if (listError) {
      console.error('[Instagram Media] purgeInstagramData storage list failed', {
        userId,
        listError,
      });
      return;
    }
    if (cachedObjects.length === 0) {
      return;
    }
    const paths = cachedObjects.map(object => `${userId}/${object.name}`);
    const { error: removeError } = await client.storage
      .from(INSTAGRAM_MEDIA_THUMBNAIL_BUCKET)
      .remove(paths);
    if (removeError) {
      console.error('[Instagram Media] purgeInstagramData storage remove failed', {
        userId,
        removeError,
      });
    }
  }

  async purgeInstagramData(userId: string): Promise<SupabaseResult<void>> {
    return SupabaseService.withServiceRoleClient(
      async client => {
        // Storage 削除と2つの DELETE は互いに独立しているため並列実行する。
        const [, { error: mediaError }, { error: insightsError }] = await Promise.all([
          this.purgeCachedThumbnails(client, userId),
          client.from('instagram_media').delete().eq('user_id', userId),
          client.from('instagram_account_insights_daily').delete().eq('user_id', userId),
        ]);

        if (mediaError) {
          return this.failure('Instagramメディアデータの削除に失敗しました', {
            developerMessage: mediaError.message,
          });
        }

        if (insightsError) {
          return this.failure('Instagramアカウント指標の削除に失敗しました', {
            developerMessage: insightsError.message,
          });
        }

        return this.success(undefined);
      },
      { logMessage: '[Instagram Media] purgeInstagramData failed' }
    );
  }
}

export const instagramMediaService = new InstagramMediaService();
