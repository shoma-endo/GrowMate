import { z } from 'zod';

import { ANALYTICS_COLUMNS, INSTAGRAM_COLUMNS } from '@/lib/constants';
import type { FieldConfigTableKey } from '@/types/field-config';

/**
 * 一覧テーブルの「フィールド構成」保存の入力スキーマ。
 *
 * 列IDは `src/lib/constants.ts` の列カタログに存在するものだけを許可する。
 * DB側は `text[]` で中身を検証できないため、ここが唯一の防波堤になる。
 */

const COLUMN_IDS_BY_TABLE_KEY: Record<FieldConfigTableKey, ReadonlySet<string>> = {
  analytics: new Set(ANALYTICS_COLUMNS.map(c => c.id)),
  instagram_media: new Set(INSTAGRAM_COLUMNS.map(c => c.id)),
};

// **受け付ける tableKey は上の定義から導出する。** リテラルを再掲すると、対象一覧を
// 足したときに片方だけ更新される。`Record<FieldConfigTableKey, ...>` は網羅を型で
// 強制するので、ここを経由すれば追加漏れは tsc が落とす
const TABLE_KEYS = Object.keys(COLUMN_IDS_BY_TABLE_KEY) as [
  FieldConfigTableKey,
  ...FieldConfigTableKey[],
];

const columnIdListSchema = z
  .array(z.string().min(1).max(64))
  // 列カタログの最大件数を超える入力は、正規の画面からは発生しない
  .max(128)
  .refine(ids => new Set(ids).size === ids.length, {
    error: '列IDが重複しています',
  });

export const saveFieldConfigSchema = z
  .object({
    tableKey: z.enum(TABLE_KEYS),
    visibleIds: columnIdListSchema,
    orderedIds: columnIdListSchema,
  })
  .superRefine((value, ctx) => {
    const allowed = COLUMN_IDS_BY_TABLE_KEY[value.tableKey];
    for (const key of ['visibleIds', 'orderedIds'] as const) {
      const unknownIds = value[key].filter(id => !allowed.has(id));
      if (unknownIds.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `未知の列ID: ${unknownIds.join(', ')}`,
        });
      }
    }
  });

export type SaveFieldConfigInput = z.infer<typeof saveFieldConfigSchema>;
