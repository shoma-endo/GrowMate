type Ga4DiagnosisCode =
  | 'R_TOP_EXIT'
  | 'R_MISMATCH'
  | 'R_MID_EXIT'
  | 'R_SKIM'
  | 'R_GOOD'
  | 'R_LOWDATA';

const GA4_DIAGNOSIS_LABELS: Record<Ga4DiagnosisCode, string> = {
  R_TOP_EXIT: '冒頭離脱型',
  R_MISMATCH: 'ミスマッチ型',
  R_MID_EXIT: '途中離脱型',
  R_SKIM: '拾い読み型',
  R_GOOD: '良好',
  R_LOWDATA: 'データ蓄積中',
};

const GA4_STATUS_LABELS: Record<string, string> = {
  unassessed: '未評価',
  eligible: '評価可能',
  low_data: 'データ蓄積中',
  evaluated: '評価済み',
  narrative_failed: '診断コメントを作成できませんでした',
  insufficient_data: 'データが不足しています',
  import_failed: 'データを取得できませんでした',
  evaluation_failed: '評価に失敗しました',
  evaluating: '評価中です',
};

const GA4_MISSING_METRIC_LABELS: Record<string, string> = {
  ga4_property: 'Google Analytics 4との連携設定',
  article_content: '記事本文',
  ga4_data: '訪問データ',
  ga4: '訪問データ',
  bounce_rate: '直帰に関するデータ',
  engagement_rate: 'エンゲージメント率',
  active_users: '読み手の人数データ',
  scroll_90_event_count: '最後まで読まれた人数データ',
};

const GA4_ERROR_LABELS: Record<string, string> = {
  evaluation_run_expired: '評価の実行が時間内に完了しませんでした。もう一度お試しください',
  ga4_api_error: '訪問データの取得に失敗しました',
  llm_rate_limited: '診断コメントの生成回数が上限に達しました',
  llm_server_error: '診断コメントの生成に失敗しました',
  llm_timeout: '診断コメントの生成が時間内に完了しませんでした',
  llm_output_invalid: '診断コメントの形式を確認できませんでした',
  insufficient_data: '評価に必要なデータが不足しています',
  evaluation_failed: '評価に失敗しました',
  unknown: '評価に失敗しました',
};

export function getGa4DiagnosisLabel(code: string | null): string {
  if (!code) return '—';
  return code in GA4_DIAGNOSIS_LABELS
    ? GA4_DIAGNOSIS_LABELS[code as Ga4DiagnosisCode]
    : '判定結果を確認できません';
}

export function getGa4EvaluationStatusLabel(status: string | null): string {
  if (!status) return GA4_STATUS_LABELS.unassessed ?? '未評価';
  const label = GA4_STATUS_LABELS[status];
  return label ?? '評価状態を確認できません';
}

export function getGa4MissingMetricLabel(metric: string): string {
  return GA4_MISSING_METRIC_LABELS[metric] ?? '必要なデータ';
}

export function getGa4EvaluationErrorLabel(errorCode: string | null): string {
  if (!errorCode) return '評価に失敗しました';
  return GA4_ERROR_LABELS[errorCode] ?? '評価に失敗しました';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getGa4DataQualityLabel(value: unknown): string {
  if (!isRecord(value)) return '確認できません';
  const missingMetrics = Array.isArray(value.missingMetrics)
    ? value.missingMetrics.filter((item): item is string => typeof item === 'string' && item !== 'gsc')
    : [];
  if (missingMetrics.length > 0) {
    return `不足: ${missingMetrics.map(getGa4MissingMetricLabel).join('、')}`;
  }
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.filter((item): item is string => typeof item === 'string')
    : [];
  const onlyLegacyGscReason = reasons.length > 0 && reasons.every(reason => reason === 'gsc_summary_missing');
  return value.partial === true && !onlyLegacyGscReason ? '一部取得' : '必要なデータを取得済み';
}

// 「合格ライン」帯（60-79）の下限。
const GA4_CONTENT_SCORE_PASSING_LINE = 60;

export function getGa4ScoreBand(score: number | null): string {
  if (score === null) return '—';
  if (score < 20) return '深刻';
  if (score < 40) return '要改善';
  if (score < GA4_CONTENT_SCORE_PASSING_LINE) return '改善の余地あり';
  if (score < 80) return '合格ライン';
  return '良好';
}

/**
 * 点数帯で色を出し分ける。
 *
 * 規則は「色は常にその数字自身の良し悪しを表す」の1本。記事カードでは
 * 大きい数字とピルはコンテンツ力スコア、内訳バーはそれぞれ読み始め／読了スコア、
 * 診断見出しは記事全体の話なのでコンテンツ力スコアで色を決める。
 * バーをコンテンツ力スコアの色で塗ると、悪い数字が良い色をまとって読み手を迷わせる。
 *
 * 段数は評価エンジン仕様 §03 の点数帯に合わせて5段にする。原文が
 * 「2つの指標も、掛け合わせも、すべて同じ点数帯の意味を持たせる。ユーザーが覚える
 * 物差しは1本だけにする」と定めているため、ラベル5段に対して色を4段へ丸めると
 * 目盛りの数が食い違う。深刻と要改善は赤の濃淡で分ける（色相を5つ使うと差が読めない）。
 * 色だけに頼らないよう帯ラベル（getGa4ScoreBand）は必ず併記する。
 *
 * 具体的な色値は原文に指定が無い（HTML は帯を .b1〜.b5 の5クラスで塗り分けているが、
 * その CSS は共有されていない）。ここは開発側の選択で、確定値が共有されたら差し替える。
 *
 * 記事カードと評価履歴の両方が参照する。片方に複製すると配色規則が2箇所へ散り、
 * 同じスコアがカードと履歴で違う色になりうる（§18 2026-08-19「配色規則を統一した」）。
 */
export function getGa4ScoreBandTone(score: number | null): {
  text: string;
  pill: string;
  bar: string;
} {
  if (score === null) return { text: 'text-gray-700', pill: 'bg-gray-100 text-gray-700', bar: 'bg-gray-400' };
  // 0-19 深刻
  if (score < 20) return { text: 'text-rose-800', pill: 'bg-rose-100 text-rose-900', bar: 'bg-rose-700' };
  // 20-39 要改善
  if (score < 40) return { text: 'text-rose-600', pill: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' };
  // 40-59 改善の余地あり
  if (score < GA4_CONTENT_SCORE_PASSING_LINE) return { text: 'text-amber-600', pill: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500' };
  // 60-79 合格ライン
  if (score < 80) return { text: 'text-sky-700', pill: 'bg-sky-50 text-sky-800', bar: 'bg-sky-500' };
  // 80-100 良好
  return { text: 'text-emerald-700', pill: 'bg-emerald-50 text-emerald-800', bar: 'bg-emerald-500' };
}

export function formatGa4Duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;
  return minutes > 0 ? `${minutes}分${remainder}秒` : `${remainder}秒`;
}

export function formatGa4ScoreDiff(diff: number | null): string {
  if (diff === null) return '初回計測';
  if (diff === 0) return '±0';
  return diff > 0 ? `+${diff}` : String(diff);
}
