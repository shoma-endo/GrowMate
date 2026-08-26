import type { Ga4EvaluationContext } from '@/types/ga4-evaluation';

export interface Ga4PromptScoreValues {
  contentScore: number;
  engageScore: number;
  readScore: number;
  diagnosisCode: string;
  rank: number;
  totalArticles: number;
  previousContentScore: number | null;
  previousEngageScore: number | null;
  previousReadScore: number | null;
}

export interface Ga4PromptMetricValues {
  sessions: number;
  engagedUsers: number;
  engagementRate: number | null;
  avgEngagementSeconds: number | null;
  expectedReadSeconds: number;
  readRate: number | null;
  scrollUsers: number | null;
  scrollRate: number | null;
}

interface Ga4PromptScrollFallbackValues {
  scrollUsers: number | null;
  /**
   * 代替文言に使うのは完読率（scroll率）ではなく**読了率**である（レビュー🟡）。
   * 受領原文 §08 は「『読了率12%』を『38人が最後まで読んだ』と換算してはならない。…
   * 取得できない場合は人数を出さず『1人あたり平均で全体の12%まで読まれています』と
   * 表記する」と定めており、この 12% は直前の文の**読了率**を指す。
   * 旧実装は scrollRate を渡していたため、入った場合に読了率と食い違う文が出ていた。
   */
  readRate: number | null;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '未取得';
  return String(Number((value * 100).toFixed(2)));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '未取得';
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;
  return minutes > 0 ? `${minutes}分${remainder}秒` : `${remainder}秒`;
}

function formatDiff(current: number, previous: number | null): string {
  if (previous === null) return '初回計測';
  const diff = current - previous;
  if (diff === 0) return '±0';
  return diff > 0 ? `+${diff}` : String(diff);
}

function countDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('評価対象期間が不正です');
  }
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function buildGa4EvaluationPromptVariables(
  context: Ga4EvaluationContext,
  scores: Ga4PromptScoreValues,
  metrics: Ga4PromptMetricValues
): Record<string, string> {
  const dateFrom = context.period.startDate;
  const dateTo = context.period.endDate;
  return {
    title: context.article.title ?? 'タイトル未登録',
    url: context.article.url,
    char_count: String(context.article.charCount),
    headings: JSON.stringify(context.article.headings),
    published_at: context.article.publishedAt ?? '未登録',
    updated_at: context.article.updatedAt ?? '未登録',
    date_from: dateFrom,
    date_to: dateTo,
    days: String(countDays(dateFrom, dateTo)),
    sessions: String(metrics.sessions),
    engaged_users: String(metrics.engagedUsers),
    engagement_rate: formatPercent(metrics.engagementRate),
    avg_time_display: formatDuration(metrics.avgEngagementSeconds),
    expected_time_display: formatDuration(metrics.expectedReadSeconds),
    read_rate: formatPercent(metrics.readRate),
    scroll_users: metrics.scrollUsers === null ? '未取得' : String(metrics.scrollUsers),
    scroll_rate: formatPercent(metrics.scrollRate),
    content_score: String(scores.contentScore),
    engage_score: String(scores.engageScore),
    read_score: String(scores.readScore),
    diagnosis_code: scores.diagnosisCode,
    rank_in_site: String(scores.rank),
    total_articles: String(scores.totalArticles),
    content_score_diff: formatDiff(scores.contentScore, scores.previousContentScore),
    engage_score_diff: formatDiff(scores.engageScore, scores.previousEngageScore),
    read_score_diff: formatDiff(scores.readScore, scores.previousReadScore),
  };
}

export function renderGa4EvaluationUserPrompt(
  template: string,
  variables: Record<string, string>,
  scroll: Ga4PromptScrollFallbackValues
): string {
  const unmeasuredScrollMessage = scroll.readRate === null
    ? '実測なし'
    : `実測なし。1人あたり平均で全体の${formatPercent(scroll.readRate)}%まで読まれています`;
  const scrollLine = scroll.scrollUsers === null
    ? `最後までスクロールした人数: ${unmeasuredScrollMessage}`
    : null;
  let rendered = scrollLine === null
    ? template
    : template.replace(/^[^\n]*\{\{scroll_users\}\}[^\n]*$/m, scrollLine);
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}
