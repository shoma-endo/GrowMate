'use server';

import { hasPaidFeatureAccess } from '@/types/user';
import { ANNOTATION_FIELD_KEYS } from '@/types/annotation';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';
import { CONTENT_CSV_IMPORT_LIMITS, canonicalizeContentCsvUrl, type ContentCsvSkippedRow } from '@/lib/content-csv-import';
import { isWithAuthEmailLinkConflict, withAuth } from '@/server/middleware/withAuth.middleware';
import { contentCsvImportSchema } from '@/server/schemas/contentCsvImport.schema';
import { SupabaseService } from '@/server/services/supabaseService';
import type { PendingContentCsvImportRow } from '@/types/database.types.pending';

export interface ContentCsvImportActionResult {
  updated: number;
  created: number;
  unchanged: number;
  skipped: ContentCsvSkippedRow[];
}

export async function importContentCsvRows(params: unknown): Promise<ServerActionResult<ContentCsvImportActionResult>> {
  const parsed = contentCsvImportSchema.safeParse(params);
  if (!parsed.success) {
    console.error('[content-csv-import] validation failed:', parsed.error.issues.map(({ code, path, message }) => ({ code, path, message })));
    return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  }

  try {
    const authResult = await withAuth(async ({ userId, userDetails }) => {
      if (!hasPaidFeatureAccess(userDetails?.role ?? null)) {
        console.error('[content-csv-import] forbidden role:', { role: userDetails?.role ?? null });
        return { success: false as const, error: ERROR_MESSAGES.USER.INSUFFICIENT_PERMISSIONS };
      }

      const rows: PendingContentCsvImportRow[] = [];
      const skipped: ContentCsvSkippedRow[] = [];
      for (const row of parsed.data.rows) {
        const url = canonicalizeContentCsvUrl(row.url);
        if (!url) {
          skipped.push({ rowNumber: row.rowNumber, url: row.url.trim(), reason: 'invalid_url' });
          continue;
        }

        const values: PendingContentCsvImportRow['values'] = {};
        for (const key of ANNOTATION_FIELD_KEYS) {
          const value = row.values[key];
          if (value !== undefined) values[key] = value;
        }
        const cells = [url, ...Object.values(values)];
        if (cells.some(value => value.length > CONTENT_CSV_IMPORT_LIMITS.maxCellLength)) {
          skipped.push({ rowNumber: row.rowNumber, url, reason: 'too_long' });
          continue;
        }
        rows.push({ rowNumber: row.rowNumber, url, values });
      }

      const result: ContentCsvImportActionResult = {
        updated: 0,
        created: 0,
        unchanged: 0,
        skipped,
      };
      if (rows.length === 0) return { success: true as const, data: result };

      const rpcResult = await new SupabaseService().importContentAnnotationsCsv(userId, rows);
      if (!rpcResult.success) throw new Error(rpcResult.error.userMessage);
      result.updated = rpcResult.data.updated;
      result.created = rpcResult.data.created;
      result.unchanged = rpcResult.data.unchanged;
      for (const item of rpcResult.data.skipped) {
        const row = rows[item.row_index - 1];
        if (!row) throw new Error('CSV RPC returned an unknown row index');
        result.skipped.push({ rowNumber: row.rowNumber, url: item.url, reason: item.reason });
      }
      return { success: true as const, data: result };
    });

    if (isWithAuthEmailLinkConflict(authResult)) {
      return { success: false, error: authResult.error, emailLinkConflict: true };
    }
    return authResult;
  } catch (error) {
    console.error('[content-csv-import] import failed:', error);
    return { success: false, error: ERROR_MESSAGES.CONTENT_CSV_IMPORT.IMPORT_FAILED };
  }
}
