'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { buildWordPressServiceFromSettings } from '@/server/services/wordpressContext';
import { importWordPressContent } from '@/server/services/wordpressImportService';
import { SupabaseService } from '@/server/services/supabaseService';
import { hasPaidFeatureAccess } from '@/types/user';

const MANUAL_IMPORT_TIME_BUDGET_MS = 700_000;

export async function runWordpressBulkImport() {
  // ページの maxDuration は Server Action の呼び出し全体にかかるので、締め切りは入口から数える
  const deadlineAt = Date.now() + MANUAL_IMPORT_TIME_BUDGET_MS;
  try {
    const authResult = await authMiddleware();
    const linkConflict = emailLinkConflictErrorPayload(authResult);
    if (linkConflict) return linkConflict;
    if (authResult.error || !authResult.userId) {
      return { success: false, error: authResult.error || ERROR_MESSAGES.AUTH.AUTH_FAILED };
    }
    const role = authResult.userDetails?.role ?? null;
    if (!hasPaidFeatureAccess(role)) {
      return { success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED };
    }

    const supabaseService = new SupabaseService();
    const userId = authResult.userId;
    const settings = await supabaseService.getWordPressSettingsByUserId(userId);
    if (!settings) return { success: false, error: ERROR_MESSAGES.WORDPRESS.SETTINGS_INCOMPLETE };

    const cookieStore = await cookies();
    const context = buildWordPressServiceFromSettings(settings, name => cookieStore.get(name)?.value);
    if (!context.success) {
      return {
        success: false,
        error: context.message,
        needsWordPressAuth: context.needsWordPressAuth ?? false,
      };
    }

    const result = await importWordPressContent({
      userId,
      settings,
      wpService: context.service,
      supabaseService,
      startedAt: new Date().toISOString(),
      deadlineAt,
    });
    if (result.kind === 'failure') return { success: false, error: result.error };

    revalidatePath('/wordpress-import');
    revalidatePath('/analytics');
    return { success: true, data: result.stats };
  } catch (error) {
    console.error('[wordpress-import] bulk import failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.WORDPRESS.IMPORT_ERROR,
    };
  }
}
