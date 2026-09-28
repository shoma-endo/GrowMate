/**
 * フィールド構成保存の入力スキーマ（`fieldConfig.schema`）
 *
 * DB側は `text[]` で中身を検証できないため、列カタログ外のIDはここで弾く。
 */
import { describe, expect, it } from 'vitest';
import { saveFieldConfigSchema } from '@/server/schemas/fieldConfig.schema';

describe('@/server/schemas/fieldConfig.schema', () => {
  describe('saveFieldConfigSchema', () => {
    it.each([
      [
        '列カタログに無いID',
        { tableKey: 'analytics', visibleIds: ['main_kw', 'not_a_column'], orderedIds: ['main_kw'] },
      ],
      [
        '別一覧の列ID（analytics に Instagram の列）',
        { tableKey: 'analytics', visibleIds: ['reach'], orderedIds: [] },
      ],
      ['未知の tableKey', { tableKey: 'users', visibleIds: [], orderedIds: [] }],
      [
        '重複した列ID',
        { tableKey: 'analytics', visibleIds: ['main_kw', 'main_kw'], orderedIds: [] },
      ],
    ])('%sを拒否する', (_label, input) => {
      expect(saveFieldConfigSchema.safeParse(input).success).toBe(false);
    });
  });
});
