import { ANALYTICS_COLUMNS } from '@/lib/constants';
import {
  SUMMARY_TARGET_FIELD_KEYS,
  type SummaryFailureCode,
} from '@/lib/content-annotation-summary-fields';

/**
 * 未要約判定の対象8項目を、一覧の列見出しと同じ表記・同じ並び順で返す。
 * フィルタの説明文で使う。独自の呼び方をすると、ユーザーがどの欄か照合できない
 * （例: `persona` の列見出しは「ペルソナ」ではなく「デモグラ・ペルソナ」）。
 */
export const SUMMARY_TARGET_COLUMN_LABELS: string[] = ANALYTICS_COLUMNS.filter(column =>
  (SUMMARY_TARGET_FIELD_KEYS as readonly string[]).includes(column.id)
).map(column => column.label);

/**
 * 失敗理由ごとの「何が起きたか」。
 *
 * 背景実行の完了メールと共有する。次に何をすればよいかはメール専用の辞書が持つ。
 */
export const FAILURE_LABELS: Record<SummaryFailureCode, string> = {
  SUMMARY_SOURCE_NOT_LINKED: 'WordPress 未連携',
  SUMMARY_CONTENT_FETCH_FAILED:
    'WordPress から本文を取得できない（連携先と違うサイトの記事か、記事が削除・非公開）',
  SUMMARY_CONTENT_TOO_LARGE: '本文が長すぎる（再実行しても同じ結果になります）',
  SUMMARY_AI_FAILED: 'AI の呼び出しに失敗（時間をおいて再実行すると成功することがあります）',
  SUMMARY_AI_RATE_LIMITED:
    'AI の利用が集中している（時間をおいて再実行すると成功することがあります）',
  SUMMARY_WP_REAUTH_REQUIRED: 'WordPress の連携が切れている（再連携すると解消します）',
  SUMMARY_PARSE_FAILED: 'AI の応答を解析できない（再実行すると成功することがあります）',
  ANNOTATION_NOT_FOUND: 'コンテンツ情報が見つからない',
  EMPTY_SUMMARY: 'AI が要約を返さなかった（再実行すると成功することがあります）',
  ITEM_TIME_LIMIT:
    '1件あたりの時間上限に達した（時間に余裕があるときに再実行すると成功することがあります）',
  SAVE_FAILED: '保存に失敗（時間をおいて再実行してください）',
  NOT_OWNED: '実行中に削除された',
  UNEXPECTED: '想定外のエラー',
};
