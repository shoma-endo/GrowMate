import { getGa4ScoreBand } from '@/lib/ga4-evaluation-display';
import { sanitizeEmailHtml } from '@/server/lib/email-html';

const MAX_TITLE_LENGTH = 40;

interface Ga4ContentEvaluationEmailNarrative {
  headline: string;
  situation: string;
  next_action: string;
  target: string;
}

export interface Ga4ContentEvaluationEmailInput {
  articleTitle: string | null;
  canonicalUrl: string | null;
  annotationId: string;
  siteUrl: string;
  /** §8.3「結末の判定契約」10値のうち、送信対象になるのはこの2値のみ（§9.5） */
  status: 'evaluated' | 'narrative_failed';
  contentScore: number;
  readScore: number;
  engageScore: number;
  siteRank: number | null;
  totalArticles: number | null;
  /** status='evaluated' かつ narrative 生成成功時のみ非null */
  narrative: Ga4ContentEvaluationEmailNarrative | null;
  periodStart: string | null;
  periodEnd: string | null;
  nextEvaluationDate: string;
}

export interface Ga4ContentEvaluationEmailContent {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSlashDate(isoDate: string): string {
  return isoDate.replaceAll('-', '/');
}

function formatPeriod(periodStart: string | null, periodEnd: string | null): string | null {
  if (!periodStart || !periodEnd) return null;
  return `${formatSlashDate(periodStart)}〜${formatSlashDate(periodEnd)}`;
}

function resolveDisplayTitle(articleTitle: string | null, canonicalUrl: string | null): string {
  const trimmedTitle = articleTitle?.trim();
  if (trimmedTitle && trimmedTitle.length > 0) {
    return trimmedTitle.length > MAX_TITLE_LENGTH
      ? `${trimmedTitle.slice(0, MAX_TITLE_LENGTH)}…`
      : trimmedTitle;
  }
  if (canonicalUrl) {
    try {
      return new URL(canonicalUrl).pathname;
    } catch {
      return canonicalUrl;
    }
  }
  return '（タイトル未取得）';
}

/**
 * 通知メールの件名・本文を組み立てる（§10.9）。文面はコードで組み立て、LLMには書かせない。
 * 診断文は評価時に生成済みの narrative_json を流用する。
 */
export function buildGa4ContentEvaluationEmail(
  input: Ga4ContentEvaluationEmailInput
): Ga4ContentEvaluationEmailContent {
  const displayTitle = resolveDisplayTitle(input.articleTitle, input.canonicalUrl);
  const subject = `【GrowMate】コンテンツ評価が完了しました：${displayTitle}`;
  const detailUrl = `${input.siteUrl}/analytics/${input.annotationId}`;
  const scoreBand = getGa4ScoreBand(input.contentScore);
  const period = formatPeriod(input.periodStart, input.periodEnd);

  // §10.3の3と同じ禁則（人数を率から換算しない）。ファネル表示はメールに載せない。
  const rankLine =
    input.siteRank !== null && input.totalArticles !== null
      ? `<p>サイト内順位: ${input.siteRank}位 / ${input.totalArticles}記事中</p>`
      : '';

  const hasNarrative = input.status === 'evaluated' && input.narrative !== null;
  const diagnosisBlock = hasNarrative
    ? `<h2>${escapeHtml(input.narrative!.headline)}</h2><p>${escapeHtml(input.narrative!.situation)}</p>`
    : '<p>診断コメントを作成できませんでした。スコアは算出済みです。</p>';
  const nextActionBlock = hasNarrative
    ? `<p><strong>次の一手:</strong> ${escapeHtml(input.narrative!.next_action)}</p>
       <p><strong>狙い:</strong> ${escapeHtml(input.narrative!.target)}</p>`
    : '';

  const html = `
    <div>
      <h1>コンテンツ評価が完了しました</h1>
      <p>${escapeHtml(displayTitle)}</p>

      <h2>コンテンツ力スコア: ${input.contentScore}点 ／ ${scoreBand}</h2>
      <p>読み始めスコア: ${input.engageScore}点　読了スコア: ${input.readScore}点</p>
      ${rankLine}

      ${diagnosisBlock}
      ${nextActionBlock}

      <p><a href="${detailUrl}">GrowMate で詳細を見る</a></p>

      <hr />
      ${period ? `<p>評価対象期間: ${period}</p>` : ''}
      <p>次回評価予定: ${formatSlashDate(input.nextEvaluationDate)}</p>
      <p>この記事に評価サイクルを設定しているため送信しています。設定の変更は<a href="${detailUrl}">記事詳細</a>から行えます。</p>
    </div>
  `;

  return { subject, html: sanitizeEmailHtml(html) };
}

export interface Ga4ConnectionLostEmailInput {
  siteUrl: string;
  /** 今回の実行で評価できなかった記事の件数 */
  skippedArticleCount: number;
  /** 次にこの記事群が評価対象になる日（クールダウンを進めた後の値） */
  nextEvaluationDate: string;
}

/**
 * GA4連携が切れていて評価できなかったことを知らせるメール（レビュー🔴6）。
 *
 * それまでは連携が切れていても、予定日を過ぎた記事は古い取込データのまま評価され、
 * スコア付きの「評価が完了しました」メールが飛んでいた。抑止条件が
 * `syncFailed && ga4_next_evaluation_date === todayJst` で、予定日を過ぎると外れるため。
 *
 * due抽出RPCは `gsc_credentials.ga4_property_id is not null` で絞るので、この経路に来るのは
 * 「一度も連携していない」ユーザーではなく「連携済みだがトークンが失効した」ユーザーである。
 * したがって案内先は再連携（/setup/ga4）でよい。
 *
 * ユーザー単位で1通にまとめる。記事ごとに送ると連携が切れた瞬間に大量のメールが飛ぶため。
 */
export function buildGa4ConnectionLostEmail(
  input: Ga4ConnectionLostEmailInput
): Ga4ContentEvaluationEmailContent {
  const subject = '【GrowMate】GA4連携が切れているためコンテンツ評価を実行できませんでした';
  const setupUrl = `${input.siteUrl}/setup/ga4`;

  const html = `
    <div>
      <h1>コンテンツ評価を実行できませんでした</h1>
      <p>Google Analytics 4 との連携が切れているため、評価に必要なデータを取得できませんでした。</p>
      <p>今回評価できなかった記事: ${input.skippedArticleCount}件</p>

      <p><a href="${setupUrl}">GrowMate で再連携する</a></p>

      <hr />
      <p>次回評価予定: ${formatSlashDate(input.nextEvaluationDate)}</p>
      <p>再連携したあとは、記事詳細の「今すぐ評価を実行」からその場で評価できます。次回評価予定日を待つ必要はありません。</p>
      <p>評価サイクルを設定している記事があるため送信しています。</p>
    </div>
  `;

  return { subject, html: sanitizeEmailHtml(html) };
}
