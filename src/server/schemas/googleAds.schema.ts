import { z } from 'zod';
import {
  campaignIdSchema,
  customerIdSchema,
  dateRangeRefinement,
  dateStringSchema,
} from '@/lib/validators/common';

/**
 * キーワード指標取得の入力スキーマ
 * customerId は DB から取得するため、ここでは日付とキャンペーン ID のみバリデーション
 */
export const getKeywordMetricsSchema = z
  .object({
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    campaignIds: z.array(campaignIdSchema).optional(),
  })
  .refine(dateRangeRefinement.refine, { message: dateRangeRefinement.message });

/**
 * カスタマー ID のバリデーション（DB から取得した値の検証用）
 */
const _customerIdSchemaExport = customerIdSchema; // 内部利用参照保持

type GetKeywordMetricsSchemaInput = z.infer<typeof getKeywordMetricsSchema>;

/**
 * API クエリパラメータ用のスキーマ（GET リクエスト向け）
 * customerId は DB から取得するため不要
 */
export const keywordMetricsQuerySchema = z.object({
  startDate: dateStringSchema,
  endDate: dateStringSchema,
}).refine(dateRangeRefinement.refine, { message: dateRangeRefinement.message });

type KeywordMetricsQueryInput = z.infer<typeof keywordMetricsQuerySchema>;
