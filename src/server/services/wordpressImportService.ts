import { normalizeCategories, normalizeCategoryNames, normalizeText, parseWpPostId } from '@/lib/utils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { CRON_CONFIGS, CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import { runDailyImportBatch } from '@/server/lib/daily-import-batch';
import { classifyWordPressImportFailure, isChangedSinceBaseline } from '@/server/lib/wordpress-diff-import';
import { normalizeContentType, normalizeContentTypes } from '@/server/services/wordpressContentTypes';
import { buildWordPressServiceFromSettings } from '@/server/services/wordpressContext';
import { resolveWpComAccessToken } from '@/server/services/wordpressContentSync';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  assertBeforeDeadline,
  normalizeWordPressRestPosts,
  WordPressImportDeadlineError,
  WordPressService,
} from '@/server/services/wordpressService';
import type { Database } from '@/types/database.types';
import type { WordPressNormalizedPost, WordPressSettings } from '@/types/wordpress';

type ImportStats = {
  /** 前回の取込を基準にした差分取込だったか（false は初回などの全件取得） */
  isDiffImport: boolean;
  totalPosts: number;
  newPosts: number;
  updatedPosts: number;
  failedUpdates: number;
  skippedExistingPosts: number;
  skippedWithoutCanonical: number;
  insertedPosts: number;
  duplicatePosts: number;
  errorPosts: number;
  existingContentTotal: number;
  contentTypes: string[];
  statsByType: Record<string, {
    totalAvailable: number;
    retrieved: number;
    newCandidates: number;
    skippedExisting: number;
    skippedWithoutCanonical: number;
    processed: number;
    duplicate: number;
    error: number;
  }>;
  backfilledTitles: number;
};

type ImportResult =
  | { kind: 'success'; stats: ImportStats }
  | { kind: 'failure'; failure: 'auth_expired' | 'temporary_failure'; error: string };

// 初回の全件取得は1万件を超えるサイトがある。1回の upsert に全件を載せると本文込みで数十MBになり、
// 既存行の UPDATE を一斉に投げると接続が詰まるため、書き込みを分割する
const INSERT_BATCH_SIZE = 500;
const UPDATE_CONCURRENCY = 20;

/**
 * 日次 cron の時間予算。route の maxDuration から、締め切り後に走りうる書き込み1回分と、
 * 結果の記録・完了ログの分を残す（WordPress への取得は締め切りまでで打ち切られる）。
 * 上限：1人の全件取込がこの予算を超えるサイトは毎回打ち切られて終わらない。その場合は
 * 全件取込を途中から再開できるようにする（仕様 R-004）。
 */
const WORDPRESS_DAILY_IMPORT_TIME_BUDGET_MS = (CRON_CONFIGS.wordpressDailyImport.maxDuration - 100) * 1000;

interface ExistingAnnotation {
  id: string;
  canonical_url: string | null;
  wp_post_id: number | null;
}

function offsetDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid WordPress import baseline');
  return date.toISOString().replace('Z', '+00:00');
}

async function fetchImportPosts(
  wpService: WordPressService,
  contentTypes: string[],
  baseline: string | null,
  deadlineAt: number | undefined
): Promise<{
  posts: WordPressNormalizedPost[];
  fetchedCount: number;
  fetchedByType: Record<string, number>;
  totalsByType: Record<string, number>;
  skippedExistingByType: Record<string, number>;
  /** 全件取得で、投稿タイプごとの件数が WordPress の総数に届かなかったタイプ */
  incompleteTypes: string[];
}> {
  if (!baseline) {
    const { posts: normalizedPosts, totalsByType, uniqueIdCountsByType } =
      await wpService.fetchAllNormalizedContentByTypes(contentTypes, { perPage: 100, ...(deadlineAt !== undefined ? { deadlineAt } : {}) });
    const fetchedByType: Record<string, number> = {};
    for (const post of normalizedPosts) {
      const type = normalizeContentType(post.post_type ?? 'posts');
      fetchedByType[type] = (fetchedByType[type] ?? 0) + 1;
    }
    const incompleteTypes = Object.entries(totalsByType)
      .filter(([type, total]) => (uniqueIdCountsByType[type] ?? 0) < total)
      .map(([type]) => type);
    return {
      posts: normalizedPosts,
      fetchedCount: normalizedPosts.length,
      fetchedByType,
      totalsByType,
      skippedExistingByType: {},
      incompleteTypes,
    };
  }

  const queryDate = offsetDate(baseline);
  const results = await Promise.all(contentTypes.flatMap(async contentType => {
    const [modified, published] = await Promise.all([
      wpService.fetchAllContentByTypes([contentType], { perPage: 100, modifiedAfter: queryDate, ...(deadlineAt !== undefined ? { deadlineAt } : {}) }),
      wpService.fetchAllContentByTypes([contentType], { perPage: 100, after: queryDate, ...(deadlineAt !== undefined ? { deadlineAt } : {}) }),
    ]);
    return { contentType, posts: [...modified.posts, ...published.posts], total: Math.max(
      modified.totalsByType[contentType] ?? 0,
      published.totalsByType[contentType] ?? 0
    ) };
  }));

  const totalsByType: Record<string, number> = {};
  const unique = new Map<string, (typeof results)[number]['posts'][number]>();
  for (const result of results) {
    totalsByType[result.contentType] = result.total;
    for (const post of result.posts) {
      const id = post.id ?? post.ID;
      unique.set(`${normalizeContentType(result.contentType)}:${id ?? post.link ?? JSON.stringify(post)}`, {
        ...post,
        type: post.type ?? result.contentType,
      });
    }
  }
  const fetchedPosts = Array.from(unique.values());
  const fetchedByType: Record<string, number> = {};
  const skippedExistingByType: Record<string, number> = {};
  const changedPosts = fetchedPosts.filter(post => {
    const type = normalizeContentType(post.type ?? 'posts');
    fetchedByType[type] = (fetchedByType[type] ?? 0) + 1;
    const changed = isChangedSinceBaseline(post, baseline);
    if (!changed) skippedExistingByType[type] = (skippedExistingByType[type] ?? 0) + 1;
    return changed;
  });
  return {
    posts: normalizeWordPressRestPosts(changedPosts),
    fetchedCount: fetchedPosts.length,
    fetchedByType,
    totalsByType,
    skippedExistingByType,
    incompleteTypes: [],
  };
}

export async function importWordPressContent({
  userId,
  settings,
  wpService,
  supabaseService,
  startedAt,
  deadlineAt,
}: {
  userId: string;
  settings: WordPressSettings;
  wpService: WordPressService;
  supabaseService: SupabaseService;
  startedAt: string;
  /** epoch ms。過ぎたら次のページの取得や次の書き込みをせずに一時的な失敗で終える（基準は進めない） */
  deadlineAt?: number;
}): Promise<ImportResult> {
  try {
    let contentTypes = normalizeContentTypes(settings.wpContentTypes);
    let baseline = settings.wpImportBaselineAt ?? null;
    if (contentTypes.length === 0) {
      const fetchedTypes = await wpService.fetchAvailableContentTypes(deadlineAt);
      if (!fetchedTypes.success || !Array.isArray(fetchedTypes.data)) {
        const error = fetchedTypes.error || ERROR_MESSAGES.WORDPRESS.CONTENT_TYPE_FETCH_FAILED;
        console.error('[wordpress-import] content type discovery failed', { userId, error });
        return { kind: 'failure', failure: 'temporary_failure', error };
      }
      contentTypes = normalizeContentTypes(fetchedTypes.data);
      if (contentTypes.length === 0) {
        return { kind: 'failure', failure: 'temporary_failure', error: ERROR_MESSAGES.WORDPRESS.CONTENT_TYPE_FETCH_FAILED };
      }
      await supabaseService.updateWordPressContentTypes(userId, contentTypes);
      baseline = null;
    }

    const { posts, fetchedCount, fetchedByType, totalsByType, skippedExistingByType, incompleteTypes } =
      await fetchImportPosts(wpService, contentTypes, baseline, deadlineAt);
    const skippedExistingPosts = Object.values(skippedExistingByType).reduce((sum, count) => sum + count, 0);
    assertBeforeDeadline(deadlineAt);
    const keys = await supabaseService.listContentAnnotationKeys(userId);
    assertBeforeDeadline(deadlineAt);
    const existingByCanonical = new Map<string, ExistingAnnotation>();
    const existingByPostId = new Map<number, ExistingAnnotation>();
    for (const row of keys) {
      const item: ExistingAnnotation = { id: row.id, canonical_url: row.canonical_url, wp_post_id: row.wp_post_id };
      const canonical = row.canonical_url?.trim();
      if (canonical) existingByCanonical.set(canonical, item);
      if (row.wp_post_id !== null) existingByPostId.set(row.wp_post_id, item);
    }

    const statsByType: ImportStats['statsByType'] = {};
    const ensureStats = (type: string) => statsByType[type] ??= {
      totalAvailable: totalsByType[type] ?? 0, retrieved: fetchedByType[type] ?? 0, newCandidates: 0,
      skippedExisting: skippedExistingByType[type] ?? 0, skippedWithoutCanonical: 0, processed: 0, duplicate: 0, error: 0,
    };
    for (const type of Object.keys(skippedExistingByType)) ensureStats(type);
    const seenIds = new Set<number>();
    const seenCanonicals = new Set<string>();
    const inserts: Database['public']['Tables']['content_annotations']['Insert'][] = [];
    const updates: Array<{ id: string; data: Database['public']['Tables']['content_annotations']['Update'] }> = [];
    let skippedWithoutCanonical = 0;
    let duplicatePosts = 0;
    const timestamp = startedAt;

    for (const post of posts) {
      const type = normalizeContentType(post.post_type ?? 'posts');
      const stats = ensureStats(type);
      const canonical = post.canonical_url?.trim();
      if (!canonical) {
        stats.skippedWithoutCanonical += 1;
        skippedWithoutCanonical += 1;
        continue;
      }
      const wpPostId = parseWpPostId(post.id);
      if ((wpPostId !== null && seenIds.has(wpPostId)) || seenCanonicals.has(canonical)) {
        stats.duplicate += 1;
        duplicatePosts += 1;
        continue;
      }
      if (wpPostId !== null) seenIds.add(wpPostId);
      seenCanonicals.add(canonical);

      const existing = existingByCanonical.get(canonical) ??
        (wpPostId !== null ? existingByPostId.get(wpPostId) : undefined);
      const nextPostType = normalizeText(post.post_type);
      const nextContent = normalizeText(post.content_text);
      const nextImageCount = post.image_count ?? null;
      const data: Database['public']['Tables']['content_annotations']['Update'] = {
        wp_post_id: wpPostId,
        wp_post_title: normalizeText(post.title),
        canonical_url: canonical,
        wp_categories: normalizeCategories(post.categories),
        wp_category_names: normalizeCategoryNames(post.categoryNames),
        wp_excerpt: normalizeText(post.excerpt),
        updated_at: timestamp,
        ...(nextPostType !== null ? { wp_post_type: nextPostType } : {}),
        ...(nextContent !== null ? { wp_content_text: nextContent } : {}),
        ...(nextImageCount !== null ? { wp_image_count: nextImageCount } : {}),
      };

      if (existing) {
        updates.push({ id: existing.id, data });
        stats.processed += 1;
      } else {
        inserts.push({ user_id: userId, ...data, created_at: timestamp });
        stats.newCandidates += 1;
        stats.processed += 1;
      }
    }

    let insertedPosts = 0;
    let backfilledTitles = 0;
    for (let index = 0; index < inserts.length; index += INSERT_BATCH_SIZE) {
      assertBeforeDeadline(deadlineAt);
      const { data, error } = await supabaseService.getClient()
        .from('content_annotations')
        .upsert(inserts.slice(index, index + INSERT_BATCH_SIZE), { onConflict: 'user_id,wp_post_id', ignoreDuplicates: true })
        .select('canonical_url, wp_post_title');
      if (error) throw error;
      insertedPosts += data?.length ?? 0;
      const missingTitles = data?.filter(row => !row.wp_post_title?.trim()) ?? [];
      const canonicalUrls = missingTitles.map(row => row.canonical_url?.trim()).filter((url): url is string => Boolean(url));
      if (canonicalUrls.length) {
        const { data: backfilled, error: backfillError } = await supabaseService.getClient()
          .from('content_annotations')
          .update({ wp_post_title: 'タイトル未設定' })
          .eq('user_id', userId)
          .in('canonical_url', canonicalUrls)
          .select('canonical_url');
        if (backfillError) throw backfillError;
        backfilledTitles += backfilled?.length ?? 0;
      }
    }

    const updateResults = [];
    for (let index = 0; index < updates.length; index += UPDATE_CONCURRENCY) {
      assertBeforeDeadline(deadlineAt);
      updateResults.push(...await Promise.all(updates.slice(index, index + UPDATE_CONCURRENCY).map(({ id, data }) =>
        supabaseService.getClient().from('content_annotations').update(data).eq('id', id).eq('user_id', userId)
      )));
    }
    const failedUpdates = updateResults.filter(result => result.error).length;
    if (failedUpdates > 0) {
      console.error('[wordpress-import] article updates failed', {
        userId,
        failedUpdates,
        errors: updateResults.flatMap(result => result.error ? [result.error.message] : []),
      });
      return {
        kind: 'failure',
        failure: 'temporary_failure',
        error: ERROR_MESSAGES.WORDPRESS.PARTIAL_UPDATES_FAILED(updates.length - failedUpdates, failedUpdates),
      };
    }
    // 全件取得が総数に届かなかった回は、取れなかった記事を差分で二度と拾えなくなるので基準を進めない（次回も全件取得）
    if (incompleteTypes.length > 0) {
      console.error('[wordpress-import] full fetch returned fewer posts than WordPress reported; baseline kept', {
        userId,
        incompleteTypes,
        fetchedByType,
        totalsByType,
      });
    } else {
      const advanced = await supabaseService.advanceWordPressImportBaseline(userId, startedAt, {
        baselineAt: baseline,
        siteUrl: settings.wpSiteUrl ?? null,
        siteId: settings.wpSiteId ?? null,
      });
      if (!advanced) {
        console.warn('[wordpress-import] settings changed during import; baseline kept', { userId });
      }
    }

    return {
      kind: 'success',
      stats: {
        isDiffImport: baseline !== null,
        totalPosts: fetchedCount,
        newPosts: inserts.length,
        updatedPosts: updates.length,
        failedUpdates,
        skippedExistingPosts,
        skippedWithoutCanonical,
        insertedPosts,
        duplicatePosts,
        errorPosts: 0,
        existingContentTotal: keys.length,
        contentTypes,
        statsByType,
        backfilledTitles,
      },
    };
  } catch (error) {
    const failure = classifyWordPressImportFailure(error);
    console.error('[wordpress-import] import failed', {
      userId,
      failure,
      error: error instanceof Error ? error.message : null,
    });
    return {
      kind: 'failure',
      failure,
      error: error instanceof WordPressImportDeadlineError
        ? ERROR_MESSAGES.WORDPRESS.IMPORT_TIMED_OUT
        : ERROR_MESSAGES.WORDPRESS.IMPORT_ERROR,
    };
  }
}

class WordPressImportService {
  private readonly supabaseService = new SupabaseService();

  async runDailyBatch() {
    return CRON_DEFINITIONS.wordpressDailyImport.runBatch(async startedAtMs => {
      const userIds = await this.supabaseService.listWordPressAutoImportTargets();
      const result = await runDailyImportBatch({
        source: 'wordpress',
        userIds,
        startedAt: startedAtMs,
        timeBudgetMs: WORDPRESS_DAILY_IMPORT_TIME_BUDGET_MS,
        importUser: async (userId, deadlineAt) => {
          const settings = await this.supabaseService.getWordPressSettingsByUserId(userId);
          if (!settings) return { ok: false, reason: 'settings_missing' };
          let tokenFailure: 'auth_expired' | 'temporary_failure' | null = null;
          if (settings.wpType === 'wordpress_com') {
            const tokenSignal = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
            try {
              const resolved = await resolveWpComAccessToken(userId, this.supabaseService, settings, tokenSignal);
              if ('failure' in resolved) tokenFailure = resolved.failure;
              else settings.wpAccessToken = resolved.accessToken;
            } catch (error) {
              // 締め切りでトークン更新を打ち切った（refreshWpComToken は中断を投げ直す）。結果を記録して次へ進む
              if (!tokenSignal.aborted) throw error;
              tokenFailure = 'temporary_failure';
            }
          }
          const context = tokenFailure
            ? null
            : buildWordPressServiceFromSettings(settings, () => undefined);
          const imported = context?.success
            ? await importWordPressContent({ userId, settings, wpService: context.service, supabaseService: this.supabaseService, startedAt: new Date(startedAtMs).toISOString(), deadlineAt })
            : {
                kind: 'failure' as const,
                failure: tokenFailure ?? classifyWordPressImportFailure(null),
                error: 'WordPress authentication unavailable',
              };
          const status = imported.kind === 'success' ? 'succeeded' : imported.failure;
          await this.supabaseService.recordWordPressAutoImportResult(userId, status);
          return imported.kind === 'success' ? { ok: true } : { ok: false, reason: imported.failure };
        },
      });
      CRON_DEFINITIONS.wordpressDailyImport.log('info', 'batch_completed', {
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        remaining: result.skippedDueToLimit,
      });
      return result;
    });
  }
}

export const wordpressImportService = new WordPressImportService();
