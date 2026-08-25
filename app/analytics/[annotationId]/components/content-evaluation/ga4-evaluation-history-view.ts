import {
  getGa4DiagnosisLabel,
  getGa4EvaluationStatusLabel,
  getGa4ScoreBandTone,
} from '@/lib/ga4-evaluation-display';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

type Ga4EvaluationHistoryItem = Ga4ContentEvaluationView['history'][number];

/**
 * pill の基底クラス。GSC の検索順位評価履歴（`../evaluation-history/evaluation-history-view.ts`）
 * と同じ文字列を使う。同じ画面に並ぶ2つの履歴でバッジの形が違うと、同型に見えない。
 */
const PILL_BASE = 'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset';
/** 失敗・未計測の配色は GSC のリテラルをそのまま使う（状態色だけは両履歴で完全に一致させる） */
const PILL_ERROR = 'bg-red-50 text-red-700 ring-red-600/20';
const PILL_NEUTRAL = 'bg-gray-50 text-gray-700 ring-gray-500/10';
/** 点数帯の pill（背景・文字色のみ）へ足す枠色。GSC の成功枝と同じ値 */
const PILL_RING_NEUTRAL = 'ring-gray-500/10';

interface Ga4EvaluationHistoryViewState {
  /** 評価そのものが失敗した行。一覧行を赤背景にし、詳細では Alert を出す */
  isError: boolean;
  /** データ不足で評価を開始できなかった行（GSC の `no_metrics` に相当） */
  isNoData: boolean;
  /** 実行中の行。完了までスコアが確定しない */
  isRunning: boolean;
  /**
   * スコアが確定している行。一覧右側の「前回 N → M 点」を出すかどうかの判定に使う。
   * `contentScore !== null` ではなく status で判定する: `evaluated` / `narrative_failed` は
   * DB の CHECK 制約（20260818000100）で3スコアの非 null が保証されており、
   * それ以外の status でスコアが入ることはない。
   */
  showScoreTransition: boolean;
  /** 常に `getGa4EvaluationStatusLabel` から引く。§10.4 が履歴に「評価済み」等の状態表示を求めている */
  statusLabel: string;
  /**
   * 一覧行のバッジ左に置く小さい文字。GSC の「判定:」「エラー:」と同じ位置・同じ役割。
   * コロンが半角なのは GSC のリテラルに合わせているため（同じ画面に並ぶ同じ部品なので揃える）。
   * 詳細ダイアログ下部のメタ情報は全角コロンで、そちらはグリッド内の他項目と揃えている。
   */
  leadLabel: string;
  badgeLabel: string;
  badgeClassName: string;
}

/**
 * 評価履歴1件の見せ方を決める。
 *
 * 一覧行は GSC と同じ「小さい文字＋pill 1つ」に収める。スコアが確定した行では
 * 小さい文字が状態（評価済み／診断コメントを作成できませんでした）を、pill が判定
 * （診断コード）を担い、pill の色はその記事のコンテンツ力スコアの点数帯で決める。
 * スコアが無い行は状態そのものを pill に出す（判定が存在しないため）。
 */
export function getGa4EvaluationHistoryState(
  item: Ga4EvaluationHistoryItem
): Ga4EvaluationHistoryViewState {
  const isError = item.status === 'evaluation_failed' || item.status === 'import_failed';
  const isNoData = item.status === 'insufficient_data';
  const isRunning = item.status === 'evaluating';
  const showScoreTransition = item.status === 'evaluated' || item.status === 'narrative_failed';
  const statusLabel = getGa4EvaluationStatusLabel(item.status);

  if (showScoreTransition) {
    return {
      isError,
      isNoData,
      isRunning,
      showScoreTransition,
      statusLabel,
      leadLabel: statusLabel,
      badgeLabel: getGa4DiagnosisLabel(item.diagnosisCode),
      // ring 色は必ず明示する。`ring-1 ring-inset` は色を指定しないと currentColor
      // （= text-emerald-800 等の濃い文字色）になり、薄い pill に濃い枠が付く。
      // GSC 側も成功枝で `ring-gray-500/10 ${outcomeConfig.className}` と同じ構造にしている。
      // 色そのものは getGa4ScoreBandTone に足さない（記事カードの pill には枠が無いため）
      badgeClassName: `${PILL_BASE} ${PILL_RING_NEUTRAL} ${getGa4ScoreBandTone(item.contentScore).pill}`,
    };
  }

  return {
    isError,
    isNoData,
    isRunning,
    showScoreTransition,
    statusLabel,
    leadLabel: isError ? 'エラー:' : '状態:',
    badgeLabel: statusLabel,
    badgeClassName: `${PILL_BASE} ${isError ? PILL_ERROR : PILL_NEUTRAL}`,
  };
}

/**
 * `index` の1つ前に成功していた評価を返す（履歴は `startedAt` 降順なので、より後ろ＝より古い）。
 *
 * 記事カードの「前回差分」と評価履歴の「前回 N → M 点」が同じ行を指すように、両方がこの関数を使う。
 * 別々に探すと同じ画面で違う「前回」を出しうる（`latest-history.ts` が警告しているのと同種の事故）。
 * 3スコアすべての非 null を条件にするのは、呼び出し側が差分を3つとも出すため。
 */
export function findPreviousScoredItem(
  history: readonly Ga4EvaluationHistoryItem[],
  index: number
): Ga4EvaluationHistoryItem | null {
  if (index < 0) return null;
  return (
    history.slice(index + 1).find(
      item =>
        (item.status === 'evaluated' || item.status === 'narrative_failed') &&
        item.contentScore !== null &&
        item.engageScore !== null &&
        item.readScore !== null
    ) ?? null
  );
}
