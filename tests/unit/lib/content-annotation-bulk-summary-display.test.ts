import { describe, expect, it } from 'vitest';

import {
  describeFailures,
  FAILURE_LABELS,
  getBulkSummaryToastMessage,
  SUMMARY_TARGET_COLUMN_LABELS,
} from '@/lib/content-annotation-bulk-summary-display';
import type { BulkSummaryResult } from '@/lib/content-annotation-summary-fields';
import type { SummaryFailureCode } from '@/lib/content-annotation-summary-fields';
import type { SummaryErrorCode } from '@/server/services/contentAnnotationSummaryService';

const base: BulkSummaryResult = {
  succeededCount: 0,
  failedCount: 0,
  failedByCode: {},
  skippedCount: 0,
  unprocessedCount: 0,
  stoppedReason: 'completed',
};

// 単記事コアの理由コードが1つでも共有側に無いと、内訳がその分だけ表示から落ちる。
// 型レベルで固定しておく（代入できなければコンパイルが通らない）
const _coreCodesAreCovered: SummaryFailureCode = null as unknown as SummaryErrorCode;
void _coreCodesAreCovered;

describe('一括要約の結果文言', () => {
  it('全件成功なら success で件数だけ出す', () => {
    const { type, message } = getBulkSummaryToastMessage({ ...base, succeededCount: 5 });
    expect(type).toBe('success');
    expect(message).toBe('5件を要約しました');
  });

  it('スキップと未実行は別々に出す（再実行で進むかが違う）', () => {
    const { message } = getBulkSummaryToastMessage({
      ...base,
      succeededCount: 3,
      skippedCount: 2,
      unprocessedCount: 4,
      stoppedReason: 'time_budget',
    });
    expect(message).toContain('スキップ 2 件');
    expect(message).toContain('未実行 4 件');
  });

  it('時間予算で打ち切られたら warning にして再実行を促す', () => {
    const { type, message } = getBulkSummaryToastMessage({
      ...base,
      succeededCount: 3,
      unprocessedCount: 7,
      stoppedReason: 'time_budget',
    });
    expect(type).toBe('warning');
    expect(message).toContain('時間上限');
    expect(message).toContain('続きから進みます');
  });

  it('失敗が混ざったら warning で、次のアクションを添える', () => {
    const { type, message, persist } = getBulkSummaryToastMessage({
      ...base,
      succeededCount: 2,
      failedCount: 1,
      failedByCode: { SUMMARY_CONTENT_TOO_LARGE: 1 },
    });
    expect(type).toBe('warning');
    expect(message).toContain('失敗 1 件');
    expect(message).toContain('未要約のまま残ります');
    // 当て推量ではなくサーバーが特定した理由を出す
    expect(message).toContain('本文が長すぎる');
    expect(message).toContain('再実行しても同じ結果');
    expect(persist).toBe(true);
  });

  it('成功0件・失敗ありは「0件を要約しました」にしない', () => {
    const { message } = getBulkSummaryToastMessage({
      ...base,
      failedCount: 5,
      failedByCode: { SUMMARY_AI_FAILED: 5 },
    });
    expect(message).not.toContain('0件を要約しました');
    expect(message).toContain('要約できませんでした');
  });

  it('括弧を入れ子にしない', () => {
    const { message } = getBulkSummaryToastMessage({ ...base, skippedCount: 900 });
    expect(message).not.toMatch(/（[^）]*（/);
  });

  it('結果が失われると困る通知だけ persist する', () => {
    expect(getBulkSummaryToastMessage({ ...base, succeededCount: 5 }).persist).toBe(false);
    expect(
      getBulkSummaryToastMessage({ ...base, succeededCount: 5, unprocessedCount: 1, stoppedReason: 'time_budget' })
        .persist
    ).toBe(true);
  });

  it('全件スキップなら「要約する記事がありませんでした」', () => {
    const { type, message } = getBulkSummaryToastMessage({ ...base, skippedCount: 3 });
    expect(type).toBe('warning');
    expect(message).toContain('要約する記事がありませんでした');
    expect(message).toContain('スキップ 3 件');
    expect(message).toContain('再実行しても変わりません');
  });

  it('0件成功・0件スキップなら補足を付けない', () => {
    expect(getBulkSummaryToastMessage(base).message).toBe('要約する記事がありませんでした');
  });
});

describe('フィルタ説明文の項目ラベル', () => {
  it('8項目そろっている（ANALYTICS_COLUMNS の id 改名で欠けないことの回帰）', () => {
    // 欠けると「…の8項目がすべて空」と言いながら7項目しか並ばない
    expect(SUMMARY_TARGET_COLUMN_LABELS).toHaveLength(8);
  });

  it('一覧の列見出しと同じ表記を使う（独自の呼び方をしない）', () => {
    expect(SUMMARY_TARGET_COLUMN_LABELS).toContain('デモグラ・ペルソナ');
    expect(SUMMARY_TARGET_COLUMN_LABELS).not.toContain('ペルソナ');
  });
});

describe('失敗の内訳', () => {
  it('理由ごとの件数を多い順に出す', () => {
    const { message } = getBulkSummaryToastMessage({
      ...base,
      succeededCount: 5,
      failedCount: 3,
      failedByCode: { SUMMARY_AI_FAILED: 1, SUMMARY_CONTENT_FETCH_FAILED: 2 },
    });
    expect(message).toContain('内訳:');
    // 件数の多い FETCH_FAILED が先
    expect(message.indexOf('本文を取得できない')).toBeLessThan(message.indexOf('AI の呼び出しに失敗'));
    expect(message).toContain('2 件');
    expect(message).toContain('1 件');
  });

  it('原因ごとに次のアクションが違うことが読み取れる', () => {
    const deterministic = getBulkSummaryToastMessage({
      ...base,
      failedCount: 1,
      failedByCode: { SUMMARY_CONTENT_TOO_LARGE: 1 },
    }).message;
    const transient = getBulkSummaryToastMessage({
      ...base,
      failedCount: 1,
      failedByCode: { SUMMARY_AI_FAILED: 1 },
    }).message;
    expect(deterministic).toContain('再実行しても同じ結果');
    expect(transient).toContain('再実行すると成功することがあります');
  });

  it('失敗0件なら内訳を出さない', () => {
    expect(getBulkSummaryToastMessage({ ...base, succeededCount: 3 }).message).not.toContain('内訳:');
  });
});

describe('失敗ラベル辞書の共用（背景化仕様 BR-B06 / BR-B10）', () => {
  // FAILURE_LABELS は `Record<SummaryFailureCode, string>` なので、コードを足して
  // ラベル行を足し忘れると型エラーになる。ここでは「本仕様で追加した2件が実際に
  // 文言を持つ」ことと、既存行の文言が変わっていないことを固定する
  it('本仕様で追加した2件のラベルがある', () => {
    expect(FAILURE_LABELS.SUMMARY_WP_REAUTH_REQUIRED).toBe(
      'WordPress の連携が切れている（再連携すると解消します）'
    );
    expect(FAILURE_LABELS.SUMMARY_AI_RATE_LIMITED).toBe(
      'AI の利用が集中している（時間をおいて再実行すると成功することがあります）'
    );
  });

  it('既存ラベルの文言は変更しない（同期版トーストと共有しているため）', () => {
    expect(FAILURE_LABELS.SUMMARY_CONTENT_FETCH_FAILED).toBe(
      'WordPress から本文を取得できない（連携先と違うサイトの記事か、記事が削除・非公開）'
    );
  });

  it('describeFailures は件数の多い順に並べる（メールの内訳と共有する並び）', () => {
    const sentence = describeFailures({
      SUMMARY_AI_RATE_LIMITED: 1,
      SUMMARY_WP_REAUTH_REQUIRED: 5,
    });
    expect(sentence.indexOf('WordPress の連携が切れている')).toBeLessThan(
      sentence.indexOf('AI の利用が集中している')
    );
  });
});
