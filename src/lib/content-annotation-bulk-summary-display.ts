import { ANALYTICS_COLUMNS } from '@/lib/constants';
import {
  SUMMARY_TARGET_FIELD_KEYS,
  type BulkSummaryResult,
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
 * AI 要約一括の結果を利用者向けの1行にする。
 *
 * 4件数を1つにまとめない（仕様 §6 出力）。**スキップ**は要約の対象外なので再実行しても
 * 変わらないが、**未実行**は時間予算切れなので再実行すれば進む。この2つを混ぜると、
 * 利用者が無駄な再実行を繰り返すか、進む分をあきらめる。
 */
/** 失敗理由ごとの「何が起きたか」と「次に何をすればよいか」 */
const FAILURE_LABELS: Record<SummaryFailureCode, string> = {
  SUMMARY_SOURCE_NOT_LINKED: 'WordPress 未連携',
  SUMMARY_CONTENT_FETCH_FAILED:
    'WordPress から本文を取得できない（連携先と違うサイトの記事か、記事が削除・非公開）',
  SUMMARY_CONTENT_TOO_LARGE: '本文が長すぎる（再実行しても同じ結果になります）',
  SUMMARY_AI_FAILED: 'AI の呼び出しに失敗（時間をおいて再実行すると成功することがあります）',
  SUMMARY_PARSE_FAILED: 'AI の応答を解析できない（再実行すると成功することがあります）',
  ANNOTATION_NOT_FOUND: 'コンテンツ情報が見つからない',
  EMPTY_SUMMARY: 'AI が要約を返さなかった（再実行すると成功することがあります）',
  SAVE_FAILED: '保存に失敗（時間をおいて再実行してください）',
  NOT_OWNED: '実行中に削除された',
  UNEXPECTED: '想定外のエラー',
};

/** 失敗の内訳を1文にする。件数の多い順に並べる */
function describeFailures(failedByCode: BulkSummaryResult['failedByCode']): string {
  const entries = Object.entries(failedByCode)
    .filter((entry): entry is [SummaryFailureCode, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '';
  return `内訳: ${entries.map(([code, n]) => `${FAILURE_LABELS[code]} ${n} 件`).join('、')}。`;
}

export function getBulkSummaryToastMessage(result: BulkSummaryResult): {
  type: 'success' | 'warning';
  message: string;
  /** 消えると結果が失われる通知は自動で閉じない（760秒待った結果を4秒で消さない） */
  persist: boolean;
} {
  const { succeededCount, failedCount, skippedCount, unprocessedCount, stoppedReason } = result;

  // 括弧の中に括弧を入れない（読みにくく、全選択ではスキップ多数が常態なので必ず出る）。
  // 語の説明は下の hint 側へ回す
  const details: string[] = [];
  if (failedCount > 0) details.push(`失敗 ${failedCount} 件`);
  if (skippedCount > 0) details.push(`スキップ ${skippedCount} 件`);
  if (unprocessedCount > 0) details.push(`未実行 ${unprocessedCount} 件`);
  const detail = details.length > 0 ? `（${details.join('、')}）` : '';

  // スキップと未実行は利用者にとって意味が正反対（前者は再実行しても変わらない、
  // 後者は再実行すれば進む）。同じ通知に並ぶので、語の意味をその場で説明する（仕様 §6 誤読罠）
  const skippedHint =
    skippedCount > 0
      ? 'スキップは要約の対象外（すでに入力済み、または WordPress 未連携）で、再実行しても変わりません。'
      : '';

  // 失敗の内訳と次のアクション。件数だけ出して「本文が長すぎるか取得できていません」と
  // 当て推量を並べても、利用者は何をすればよいか決められない（仕様 §8 AI観点「原因と次の
  // アクションをセットで表示」）。サーバーが特定した理由コードをそのまま見せる
  const failedHint =
    failedCount > 0
      ? `失敗した記事は未要約のまま残ります。${describeFailures(result.failedByCode)}`
      : '';

  const hint = [skippedHint, failedHint].filter(Boolean).join(' ');
  const hintSuffix = hint ? ` ${hint}` : '';

  if (stoppedReason === 'time_budget') {
    // 成功0件で「0件を要約しました」と言わない（completed 側と揃える）
    const head =
      succeededCount === 0
        ? `1件も要約できませんでした${detail}`
        : `${succeededCount}件を要約しました${detail}`;
    return {
      type: 'warning',
      persist: true,
      message: `${head}。時間上限のため中断しました。未実行分はもう一度実行すると続きから進みます。${hintSuffix}`,
    };
  }

  if (succeededCount === 0 && failedCount > 0) {
    return {
      type: 'warning',
      persist: true,
      message: `要約できませんでした${detail}。${hint}`,
    };
  }

  if (failedCount > 0) {
    return {
      type: 'warning',
      persist: true,
      message: `${succeededCount}件を要約しました${detail}。${hint}`,
    };
  }

  if (succeededCount === 0) {
    return {
      type: 'warning',
      persist: false,
      message:
        skippedCount > 0
          ? `要約する記事がありませんでした${detail}。${hint}`
          : '要約する記事がありませんでした',
    };
  }

  return {
    type: 'success',
    persist: false,
    message: `${succeededCount}件を要約しました${detail}`,
  };
}
