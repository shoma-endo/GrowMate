'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { buildWordPressServiceFromSettings } from '@/server/services/wordpressContext';
import { normalizeWordPressRestPosts } from '@/server/services/wordpressService';
import {
  normalizeContentTypes,
  normalizeContentType,
} from '@/server/services/wordpressContentTypes';
import type { WordPressNormalizedPost } from '@/types/wordpress';
import type { Database } from '@/types/database.types';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  areArraysEqual,
  normalizeCategories,
  normalizeCategoryNames,
  normalizeText,
  parseWpPostId,
} from '@/lib/utils';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';

export async function runWordpressBulkImport() {
  try {
    const authResult = await authMiddleware();
    const linkConflict = emailLinkConflictErrorPayload(authResult);
    if (linkConflict) return linkConflict;
    if (authResult.error || !authResult.userId) {
      return { success: false, error: authResult.error || ERROR_MESSAGES.AUTH.LIFF_AUTH_FAILED };
    }
    const role = authResult.userDetails?.role ?? null;
    if (!role || role === 'unavailable') {
      return { success: false, error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED };
    }

    const supabaseService = new SupabaseService();
    const supabaseClient = supabaseService.getClient();
    const userId = authResult.userId;
    const wpSettings = await supabaseService.getWordPressSettingsByUserId(userId);
    if (!wpSettings) {
      return { success: false, error: ERROR_MESSAGES.WORDPRESS.SETTINGS_INCOMPLETE };
    }

    const cookieStore = await cookies();
    const buildResult = buildWordPressServiceFromSettings(
      wpSettings,
      name => cookieStore.get(name)?.value
    );

    if (!buildResult.success) {
      return {
        success: false,
        error: buildResult.message,
        needsWordPressAuth: buildResult.needsWordPressAuth ?? false,
      };
    }

    const wpService = buildResult.service;

    const perPage = 100;
    let contentTypes = normalizeContentTypes(wpSettings.wpContentTypes);

    if (contentTypes.length === 0) {
      const fetchedTypesResult = await wpService.fetchAvailableContentTypes();
      if (!fetchedTypesResult.success || !Array.isArray(fetchedTypesResult.data)) {
        return {
          success: false,
          error: fetchedTypesResult.error || ERROR_MESSAGES.WORDPRESS.CONTENT_TYPE_FETCH_FAILED,
        };
      }

      const autoContentTypes = normalizeContentTypes(fetchedTypesResult.data);
      if (autoContentTypes.length === 0) {
        return { success: false, error: ERROR_MESSAGES.WORDPRESS.CONTENT_TYPE_FETCH_FAILED };
      }

      await supabaseService.updateWordPressContentTypes(userId, autoContentTypes);
      contentTypes = autoContentTypes;
    }

    const allPosts: WordPressNormalizedPost[] = [];
    const statsByType = new Map<
      string,
      {
        totalAvailable: number;
        retrieved: number;
        newCandidates: number;
        skippedExisting: number;
        skippedWithoutCanonical: number;
        processed: number;
        duplicate: number;
        error: number;
      }
    >();

    const ensureStats = (type: string) => {
      const key = normalizeContentType(type || 'posts');
      if (!statsByType.has(key)) {
        statsByType.set(key, {
          totalAvailable: 0,
          retrieved: 0,
          newCandidates: 0,
          skippedExisting: 0,
          skippedWithoutCanonical: 0,
          processed: 0,
          duplicate: 0,
          error: 0,
        });
      }
      return statsByType.get(key)!;
    };

    let maxLimitReached = false;
    let maxLimitValue = 1000;
    try {
      const {
        posts: rawPosts,
        totalsByType,
        wasTruncated,
        maxItems,
      } = await wpService.fetchAllContentByTypes(contentTypes, { perPage, maxItems: 1000 });

      maxLimitReached = wasTruncated;
      maxLimitValue = maxItems;

      Object.entries(totalsByType).forEach(([type, total]) => {
        ensureStats(type).totalAvailable = total;
      });

      const normalizedRaw = normalizeWordPressRestPosts(rawPosts);
      normalizedRaw.forEach(post => {
        const type = normalizeContentType(post.post_type ?? 'posts');
        ensureStats(type).retrieved += 1;
      });

      allPosts.push(...normalizedRaw);
    } catch (error) {
      console.error('Failed to fetch WordPress content:', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : ERROR_MESSAGES.WORDPRESS.CONTENT_FETCH_ERROR,
      };
    }

    const { data: existingAnnotations, error: existingError } = await supabaseClient
      .from('content_annotations')
      .select(
        'id, canonical_url, wp_post_id, wp_post_title, wp_excerpt, wp_categories, wp_category_names, wp_post_type'
      )
      .eq('user_id', userId);

    if (existingError) {
      return {
        success: false,
        error: ERROR_MESSAGES.WORDPRESS.ANNOTATION_FETCH_ERROR(existingError.message),
      };
    }

    interface ExistingAnnotation {
      id: string;
      canonical_url: string | null;
      wp_post_id: number | null;
      wp_post_title: string | null;
      wp_excerpt: string | null;
      wp_categories: number[] | null;
      wp_category_names: string[] | null;
      wp_post_type: string | null;
    }

    const existingUrls = new Set<string>();
    const existingPostIds = new Set<number>();
    const existingByCanonical = new Map<string, ExistingAnnotation>();
    const existingByPostId = new Map<number, ExistingAnnotation>();

    (existingAnnotations as ExistingAnnotation[] | null | undefined)?.forEach(annotation => {
      const canonicalTrimmed = annotation.canonical_url?.trim();
      if (canonicalTrimmed) {
        existingUrls.add(canonicalTrimmed);
        existingByCanonical.set(canonicalTrimmed, annotation);
      }
      if (annotation.wp_post_id !== null && annotation.wp_post_id !== undefined) {
        existingPostIds.add(annotation.wp_post_id);
        existingByPostId.set(annotation.wp_post_id, annotation);
      }
    });

    const maxAllowed = 1000;
    if (allPosts.length > maxAllowed) {
      maxLimitReached = true;
      maxLimitValue = maxAllowed;
    }

    const normalized = allPosts.slice(0, maxAllowed);

    const batchSeenIds = new Set<number>();
    const batchSeenCanonical = new Set<string>();
    let skippedUnchanged = 0;
    let duplicateSkipped = 0;
    let skippedWithoutCanonical = 0;

    const toInsert: Database['public']['Tables']['content_annotations']['Insert'][] = [];
    const toUpdate: {
      id: string;
      data: Database['public']['Tables']['content_annotations']['Update'];
    }[] = [];
    const batchTimestamp = new Date().toISOString();

    normalized.forEach(post => {
      const canonical = post.canonical_url?.trim();
      const hasCanonical = canonical && canonical.length > 0;
      const wpPostId = parseWpPostId(post.id);
      const isBatchDuplicateId = wpPostId !== null && batchSeenIds.has(wpPostId);
      const isBatchDuplicateUrl = hasCanonical ? batchSeenCanonical.has(canonical) : false;

      const type = normalizeContentType(post.post_type ?? 'posts');
      const stats = ensureStats(type);

      if (!hasCanonical) {
        stats.skippedWithoutCanonical += 1;
        skippedWithoutCanonical += 1;
        return;
      }

      if (isBatchDuplicateId || isBatchDuplicateUrl) {
        stats.duplicate += 1;
        duplicateSkipped += 1;
        return;
      }

      if (wpPostId !== null) {
        batchSeenIds.add(wpPostId);
      }
      if (canonical) {
        batchSeenCanonical.add(canonical);
      }

      const nextTitle = normalizeText(post.title);
      const nextExcerpt = normalizeText(post.excerpt);
      const nextPostType = normalizeText(post.post_type);
      const nextCategories = normalizeCategories(post.categories);
      const nextCategoryNames = normalizeCategoryNames(post.categoryNames);

      const existing =
        (canonical ? existingByCanonical.get(canonical) : undefined) ??
        (wpPostId !== null ? existingByPostId.get(wpPostId) : undefined);

      const baseData: Database['public']['Tables']['content_annotations']['Update'] = {
        wp_post_id: wpPostId,
        wp_post_title: nextTitle,
        canonical_url: canonical ?? null,
        wp_categories: nextCategories,
        wp_category_names: nextCategoryNames,
        wp_excerpt: nextExcerpt,
        updated_at: batchTimestamp,
        ...(nextPostType !== null ? { wp_post_type: nextPostType } : {}),
      };

      if (existing) {
        const hasChanges =
          normalizeText(existing.canonical_url) !== canonical ||
          existing.wp_post_id !== wpPostId ||
          normalizeText(existing.wp_post_title) !== nextTitle ||
          normalizeText(existing.wp_excerpt) !== nextExcerpt ||
          normalizeText(existing.wp_post_type) !== nextPostType ||
          !areArraysEqual(existing.wp_categories ?? null, nextCategories) ||
          !areArraysEqual(existing.wp_category_names ?? null, nextCategoryNames);

        if (!hasChanges) {
          stats.skippedExisting += 1;
          skippedUnchanged += 1;
          return;
        }
        toUpdate.push({
          id: existing.id,
          data: baseData,
        });
        stats.processed += 1;
        return;
      }

      stats.newCandidates += 1;
      toInsert.push({
        user_id: userId,
        ...baseData,
        created_at: batchTimestamp,
      });
      stats.processed += 1;
    });

    let inserted = 0;
    let updated = 0;
    let failedUpdates = 0;
    const titlesBackfilled: string[] = [];

    if (toInsert.length > 0) {
      const { data: insertedRows, error: insertError } = await supabaseClient
        .from('content_annotations')
        .insert(toInsert)
        .select('canonical_url, wp_post_title');

      if (insertError) {
        return { success: false, error: insertError.message };
      }

      inserted = insertedRows?.length ?? 0;

      const needBackfill = insertedRows?.filter(
        row => !row.wp_post_title || row.wp_post_title.trim().length === 0
      );
      if (needBackfill && needBackfill.length > 0) {
        const { data: backfilledRows, error: backfillError } = await supabaseClient
          .from('content_annotations')
          .update({ wp_post_title: 'タイトル未設定' })
          .in(
            'canonical_url',
            needBackfill
              .map(row => row.canonical_url?.trim())
              .filter((url): url is string => Boolean(url && url.length > 0))
          )
          .select('canonical_url');
        if (backfillError) {
          console.warn('[wordpress-import] Backfill failed:', backfillError.message);
        }
        titlesBackfilled.push(...(backfilledRows?.map(row => row.canonical_url ?? '') ?? []));
      }
    }

    if (toUpdate.length > 0) {
      const updatePromises = toUpdate.map(item =>
        supabaseClient
          .from('content_annotations')
          .update(item.data)
          .eq('id', item.id)
          .eq('user_id', userId)
      );

      const updateResults = await Promise.allSettled(updatePromises);
      const failures: string[] = [];

      updateResults.forEach((result, index) => {
        const item = toUpdate[index];
        if (!item) return;

        if (result.status === 'fulfilled') {
          const { error } = result.value;
          if (error) {
            const errorMessage = error?.message || 'Unknown error';
            failures.push(`ID ${item.id}: ${errorMessage}`);
          } else {
            updated += 1;
          }
        } else {
          const reasonMessage =
            result.reason instanceof Error
              ? result.reason.message
              : typeof result.reason === 'string'
                ? result.reason
                : 'Promise rejected';
          failures.push(`ID ${item.id}: ${reasonMessage}`);
        }
      });

      if (failures.length > 0) {
        console.error('[wordpress-import] Update failures:', failures);
        failedUpdates = failures.length;
        // 部分的な失敗を許容し、成功した更新は反映する
        // 全ての更新が失敗した場合のみエラーを返す
        if (failures.length === toUpdate.length) {
          return {
            success: false,
            error: ERROR_MESSAGES.WORDPRESS.ALL_UPDATES_FAILED(failures),
          };
        }
      }
    }

    const statsByTypeSerialized = Array.from(statsByType.entries()).reduce<
      Record<
        string,
        {
          totalAvailable: number;
          retrieved: number;
          newCandidates: number;
          skippedExisting: number;
          skippedWithoutCanonical: number;
          processed: number;
          duplicate: number;
          error: number;
        }
      >
    >((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});

    revalidatePath('/wordpress-import');
    revalidatePath('/analytics');

    return {
      success: true,
      data: {
        totalPosts: allPosts.length,
        newPosts: toInsert.length,
        updatedPosts: updated,
        failedUpdates: failedUpdates,
        skippedExistingPosts: skippedUnchanged,
        skippedWithoutCanonical,
        insertedPosts: inserted,
        duplicatePosts: duplicateSkipped,
        errorPosts: 0,
        existingContentTotal: existingUrls.size,
        contentTypes: contentTypes,
        statsByType: statsByTypeSerialized,
        maxLimitReached,
        maxLimitValue,
        backfilledTitles: titlesBackfilled.length,
      },
    };
  } catch (error) {
    console.error('[wordpress-import] bulk import failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.WORDPRESS.IMPORT_ERROR,
    };
  }
}
