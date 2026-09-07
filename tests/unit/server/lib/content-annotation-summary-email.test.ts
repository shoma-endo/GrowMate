import { describe, expect, it } from 'vitest';

import {
  buildContentAnnotationSummaryEmail,
  type ContentAnnotationSummaryEmailInput,
} from '@/server/lib/content-annotation-summary-email';

const SITE_URL = 'https://example.test';

const base = {
  siteUrl: SITE_URL,
  status: 'completed' as const,
  totalCount: 267,
  succeededCount: 0,
  failedCount: 0,
  skippedCount: 0,
  unprocessedCount: 0,
  failedByCode: {},
};

/**
 * 完了メールの件名・見出しは**「終わり方 × 成功件数 × 失敗件数」の3軸**で決まる
 * （docs/plans/content-annotation-bulk-summary-background-spec.md §9 件名表の5行）。
 *
 * この網が無いと AC では検知できない欠陥が2つ通る:
 * - 全件失敗でもジョブは `completed` になるので、状態だけで分岐すると1件も要約できて
 *   いない利用者に「AI要約が完了しました（成功 0 件）」が届く。
 * - `mode: 'all'` の2回目は全件スキップ（失敗0件）で終わるので、成功件数だけで分岐すると
 *   **何も失敗していない**利用者に「完了できませんでした」が届く。
 */
describe('完了メールの件名・見出し（§9 件名表の5行）', () => {
  it('completed × 成功1件以上 → 完了しました', () => {
    const { subject, html } = buildContentAnnotationSummaryEmail({
      ...base,
      succeededCount: 245,
      failedCount: 10,
      skippedCount: 12,
    });
    expect(subject).toBe('【GrowMate】AI要約が完了しました（成功 245 件 / 対象 267 件）');
    expect(html).toContain('<h1>AI要約が完了しました</h1>');
  });

  it('completed × 成功0件 × 失敗1件以上 → 完了できませんでした（「完了しました」にしない）', () => {
    const { subject, html } = buildContentAnnotationSummaryEmail({
      ...base,
      failedCount: 267,
      failedByCode: { SUMMARY_WP_REAUTH_REQUIRED: 267 },
    });
    expect(subject).toBe('【GrowMate】AI要約を完了できませんでした（成功 0 件 / 対象 267 件）');
    expect(subject).not.toContain('完了しました（');
    expect(html).toContain('<h1>AI要約を完了できませんでした</h1>');
  });

  it('completed × 成功0件 × 失敗0件（全件スキップ）→ 対象がありませんでした', () => {
    const { subject, html } = buildContentAnnotationSummaryEmail({
      ...base,
      totalCount: 1000,
      skippedCount: 1000,
    });
    expect(subject).toBe('【GrowMate】AI要約の対象がありませんでした（対象 1000 件）');
    expect(html).toContain('<h1>AI要約の対象がありませんでした</h1>');
    // 何も失敗していないので「完了できませんでした」を名乗らない
    expect(html).not.toContain('完了できませんでした');
    // 失敗0件なので内訳ブロックは見出しごと出さない
    expect(html).not.toContain('失敗の内訳');
  });

  it('failed × 成功1件以上 → 途中で終了しました', () => {
    const { subject, html } = buildContentAnnotationSummaryEmail({
      ...base,
      status: 'failed',
      succeededCount: 120,
      unprocessedCount: 100,
    });
    expect(subject).toBe('【GrowMate】AI要約が途中で終了しました（成功 120 件 / 対象 267 件）');
    expect(html).toContain('<h1>AI要約が途中で終了しました</h1>');
  });

  it('failed × 成功0件 → 完了できませんでした', () => {
    const { subject } = buildContentAnnotationSummaryEmail({
      ...base,
      status: 'failed',
      failedCount: 3,
    });
    expect(subject).toBe('【GrowMate】AI要約を完了できませんでした（成功 0 件 / 対象 267 件）');
  });
});

describe('完了メールの本文', () => {
  it('0件の区分は行ごと省く', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      succeededCount: 5,
    });
    expect(html).toContain('成功 5 件');
    expect(html).not.toContain('失敗 0 件');
    expect(html).not.toContain('スキップ 0 件');
    expect(html).not.toContain('未実行 0 件');
  });

  it('「完了できませんでした」のときだけ 成功 0 件 を明示する（見出しの根拠を消さない）', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      failedCount: 267,
      failedByCode: { SUMMARY_WP_REAUTH_REQUIRED: 267 },
    });
    expect(html).toContain('成功 0 件');
  });

  it('スキップが0件なら語の説明を出さない', () => {
    const { html } = buildContentAnnotationSummaryEmail({ ...base, succeededCount: 5 });
    expect(html).not.toContain('スキップは要約の対象外');
  });

  it('スキップが1件以上なら語の説明を出す（スキップと未実行の誤読を防ぐ）', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      succeededCount: 5,
      skippedCount: 2,
    });
    expect(html).toContain('スキップは要約の対象外');
  });

  it('失敗の内訳は件数の多い順に並び、理由ごとに次にすることが付く', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      failedCount: 8,
      failedByCode: { SUMMARY_AI_RATE_LIMITED: 2, SUMMARY_WP_REAUTH_REQUIRED: 6 },
    });
    expect(html.indexOf('WordPress の連携が切れている')).toBeLessThan(
      html.indexOf('AI の利用が集中している')
    );
    expect(html).toContain('設定画面から WordPress を再連携してから、もう一度お試しください。');
    expect(html).toContain('時間をおいてもう一度お試しください。');
  });

  it('WordPress の連携切れがあるときは再連携リンクを絶対 URL で出す（AC-B16）', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      failedCount: 6,
      failedByCode: { SUMMARY_WP_REAUTH_REQUIRED: 6 },
    });
    expect(html).toContain(`href="${SITE_URL}/setup/wordpress"`);
    expect(html).toContain('GrowMate で再連携する');
  });

  it('一覧リンクも絶対 URL（相対パスはメールクライアントで機能しない）', () => {
    const { html } = buildContentAnnotationSummaryEmail({ ...base, succeededCount: 1 });
    expect(html).toContain(`href="${SITE_URL}/analytics"`);
    expect(html).not.toContain('href="/analytics"');
    expect(html).not.toContain('href="/setup/wordpress"');
  });

  it('completed では「もう一度実行すると続きから進む」旨を出さない（誤案内になる）', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      succeededCount: 100,
      unprocessedCount: 0,
    });
    expect(html).not.toContain('残りの記事から続けられます');
  });

  it('completed かつ成功0件でも「続きから」を出さない（全件処理は終わっている）', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      failedCount: 267,
      failedByCode: { SUMMARY_CONTENT_FETCH_FAILED: 267 },
    });
    expect(html).not.toContain('残りの記事から続けられます');
  });

  it('failed のときだけ続行の案内を出す。成功0件なら「途中までの結果です。」を省く', () => {
    const withResult = buildContentAnnotationSummaryEmail({
      ...base,
      status: 'failed',
      succeededCount: 120,
    });
    expect(withResult.html).toContain('途中までの結果です。');
    expect(withResult.html).toContain('残りの記事から続けられます');

    const withoutResult = buildContentAnnotationSummaryEmail({
      ...base,
      status: 'failed',
      failedCount: 2,
    });
    expect(withoutResult.html).not.toContain('途中までの結果です。');
    expect(withoutResult.html).toContain('残りの記事から続けられます');
  });

  it('機能名は AI要約（半角スペースを入れない）', () => {
    const { subject, html } = buildContentAnnotationSummaryEmail({ ...base, succeededCount: 1 });
    expect(subject).not.toContain('AI 要約');
    expect(html).not.toContain('AI 要約');
  });

  it('分母語は「対象」で統一する（ツールバーの「全 M 件」と混ぜない）', () => {
    const { subject, html } = buildContentAnnotationSummaryEmail({ ...base, succeededCount: 1 });
    expect(subject).toContain('対象 267 件');
    expect(html).toContain('対象 267 件');
    expect(html).not.toContain('全 267 件');
  });
  it('辞書に無い失敗コードは内訳から落とす（過去データで組み立てごと落とさない）', () => {
    const { html } = buildContentAnnotationSummaryEmail({
      ...base,
      failedCount: 4,
      failedByCode: {
        SUMMARY_AI_RATE_LIMITED: 1,
        // 現在の集合に無いコード（過去のジョブ行を想定）
        LEGACY_UNKNOWN_CODE: 3,
      } as ContentAnnotationSummaryEmailInput['failedByCode'],
    });
    expect(html).toContain('AI の利用が集中している');
    expect(html).not.toContain('LEGACY_UNKNOWN_CODE');
    expect(html).not.toContain('undefined');
  });
});
