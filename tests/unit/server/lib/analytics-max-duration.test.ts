import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC,
  CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS,
} from '@/lib/constants';

// Next.js の route segment config は静的解析のため import 定数を使えず、
// app/analytics/page.tsx の maxDuration はリテラル必須。コメントによる手動同期だけだと
// 片方を変えたときに気づけないので機械的に突き合わせる
// （tests/unit/server/lib/cron-config-consistency.test.ts と同型）。
describe('/analytics の maxDuration と一括要約の時間予算', () => {
  const pageSource = readFileSync('app/analytics/page.tsx', 'utf8');
  const maxDuration = Number(pageSource.match(/export const maxDuration = (\d+)/)?.[1]);

  it('page.tsx の maxDuration が定数と一致する', () => {
    expect(maxDuration).toBe(CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC);
  });

  it('時間予算は maxDuration より短い（レスポンス返却の余裕を残す）', () => {
    expect(CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS).toBeLessThan(maxDuration * 1000);
  });

  it('時間予算は仕様 BR-03 の 760 秒', () => {
    expect(CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS).toBe(760_000);
  });
});
