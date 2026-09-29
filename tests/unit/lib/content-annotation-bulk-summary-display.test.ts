import { describe, expect, it } from 'vitest';

import { SUMMARY_TARGET_COLUMN_LABELS } from '@/lib/content-annotation-bulk-summary-display';
import type { SummaryFailureCode } from '@/lib/content-annotation-summary-fields';
import type { SummaryErrorCode } from '@/server/services/contentAnnotationSummaryService';

// 単記事コアの理由コードが1つでも共有側に無いと、内訳がその分だけ表示から落ちる。
// 型レベルで固定しておく（代入できなければコンパイルが通らない）
const _coreCodesAreCovered: SummaryFailureCode = null as unknown as SummaryErrorCode;
void _coreCodesAreCovered;

describe('フィルタ説明文の項目ラベル', () => {
  it('8項目そろっている（ANALYTICS_COLUMNS の id 改名で欠けないことの回帰）', () => {
    // 欠けると「…の8項目がすべて空」と言いながら7項目しか並ばない
    expect(SUMMARY_TARGET_COLUMN_LABELS).toHaveLength(8);
  });
});
