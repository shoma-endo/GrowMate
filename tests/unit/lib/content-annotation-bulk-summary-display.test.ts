import { describe, expect, it } from 'vitest';

import {
  FAILURE_LABELS,
  SUMMARY_TARGET_COLUMN_LABELS,
} from '@/lib/content-annotation-bulk-summary-display';
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

  it('一覧の列見出しと同じ表記を使う（独自の呼び方をしない）', () => {
    expect(SUMMARY_TARGET_COLUMN_LABELS).toContain('デモグラ・ペルソナ');
    expect(SUMMARY_TARGET_COLUMN_LABELS).not.toContain('ペルソナ');
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

});
