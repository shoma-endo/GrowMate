import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC,
  CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS,
  INSTAGRAM_SYNC_MAX_DURATION_SEC,
} from '@/lib/constants';

// Next.js の route segment config は静的解析のため import 定数を使えず、
// `export const maxDuration` はリテラル必須。コメントによる手動同期だけだと
// 片方を変えたときに気づけないので機械的に突き合わせる
// （tests/unit/server/lib/cron-config-consistency.test.ts と同型）。
//
// **2026-09-04 バックグラウンド化で帰属先が変わった。**
// `CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC` の突き合わせ先は
// cron ルートで、`cron-config-consistency.test.ts` が `CRON_CONFIGS` 経由で見ている。
// `app/analytics/page.tsx` の `maxDuration = 800` は **Instagram 手動同期のために独立して必要**
// なので削らない。ここではその値が Instagram 側の定数と一致していることを見る。
describe('/analytics の maxDuration と一括要約の時間予算', () => {
  const pageSource = readFileSync('app/analytics/page.tsx', 'utf8');
  const pageMaxDuration = Number(pageSource.match(/export const maxDuration = (\d+)/)?.[1]);

  it('page.tsx の maxDuration は Instagram 手動同期の定数と一致する', () => {
    expect(pageMaxDuration).toBe(INSTAGRAM_SYNC_MAX_DURATION_SEC);
  });

  it('一括要約の maxDuration の帰属先は cron ルートである', () => {
    const routeSource = readFileSync('app/api/cron/content-annotation-summary/route.ts', 'utf8');
    const routeMaxDuration = Number(routeSource.match(/export const maxDuration = (\d+)/)?.[1]);

    expect(routeMaxDuration).toBe(CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC);
  });

  it('時間予算は maxDuration より短い（レスポンス返却の余裕を残す）', () => {
    expect(CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS).toBeLessThan(
      CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC * 1000
    );
  });

  it('時間予算は仕様 BR-B04 の 760 秒', () => {
    expect(CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS).toBe(760_000);
  });
});
