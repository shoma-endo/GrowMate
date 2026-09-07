import { FAILURE_LABELS } from '@/lib/content-annotation-bulk-summary-display';
import type { SummaryFailureCode } from '@/lib/content-annotation-summary-fields';
import { sanitizeEmailHtml } from '@/server/lib/email-html';

/**
 * AI要約一括のバックグラウンド実行の完了メール（件名・HTML本文）。
 * 正本: docs/plans/content-annotation-bulk-summary-background-spec.md §9「完了メールの件名・本文」
 *
 * 文面はコードで組み立てる（LLM には書かせない）。前例は `ga4-content-evaluation-email.ts`。
 *
 * **機能名の表記は `AI要約`（半角スペースを入れない）**。既存の利用者向け文言
 * （`ERROR_MESSAGES.WORDPRESS.SUMMARY_AI_FAILED` など）と `ui-text.md` の用語辞書に揃える。
 * 同じ機能が画面では「AI要約」、メールでは「AI 要約」になるほうが利用者には有害。
 *
 * **分母語は「対象」で統一する**（進捗表示と揃える。§6 UI用語）。
 */

/** 「何が起きたか」は `FAILURE_LABELS` を共用し、「次にすること」だけメール専用に持つ */
const FAILURE_NEXT_ACTIONS: Record<SummaryFailureCode, string> = {
  SUMMARY_WP_REAUTH_REQUIRED: '設定画面から WordPress を再連携してから、もう一度お試しください。',
  SUMMARY_AI_RATE_LIMITED: '時間をおいてもう一度お試しください。',
  SUMMARY_CONTENT_FETCH_FAILED:
    '記事が削除・非公開になっていないか、連携先のサイトが正しいかを確認してください。',
  SUMMARY_CONTENT_TOO_LARGE: '本文が長いため要約できません。もう一度実行しても同じ結果になります。',
  SUMMARY_SOURCE_NOT_LINKED: 'WordPress と連携すると要約できます。',
  SUMMARY_AI_FAILED: '時間をおいてもう一度お試しください。',
  SUMMARY_PARSE_FAILED: '時間をおいてもう一度お試しください。',
  EMPTY_SUMMARY: '時間をおいてもう一度お試しください。',
  SAVE_FAILED: '時間をおいてもう一度お試しください。',
  ITEM_TIME_LIMIT: '時間をおいてもう一度お試しください。',
  UNEXPECTED: '時間をおいてもう一度お試しください。',
  ANNOTATION_NOT_FOUND: '対象の記事が見つかりません。一覧を再読み込みして確認してください。',
  NOT_OWNED: '対象の記事が見つかりません。一覧を再読み込みして確認してください。',
};

export interface ContentAnnotationSummaryEmailInput {
  siteUrl: string;
  /** ジョブの終わり方。`failed` は想定外例外か「前進の無い claim が3回連続」 */
  status: 'completed' | 'failed';
  /** 起票時に固定した対象ID数（要約される見込み件数ではない） */
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  /** 未実行（`totalCount - processedCount`）。0 なら行ごと省く */
  unprocessedCount: number;
  failedByCode: Partial<Record<SummaryFailureCode, number>>;
}

export interface ContentAnnotationSummaryEmailContent {
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

/**
 * 見出しの分岐。**「終わり方 × 成功件数 × 失敗件数」の3軸**で決める（§9 件名表の5行）。
 *
 * 状態だけで分岐すると、全件失敗でも `completed` になるジョブ（＝WordPress の連携が切れていて
 * 全件が本文取得に失敗した利用者）に「AI要約が完了しました（成功 0 件）」が届く。
 * 逆に成功件数だけで分岐すると、`mode: 'all'` の2回目のように**何も失敗していない**
 * 全件スキップの利用者に「完了できませんでした」が届く。どちらも AC では検知できない。
 */
type SummaryEmailHeadlineKind = 'completed' | 'no_target' | 'failed_all' | 'interrupted';

function resolveSummaryEmailHeadlineKind(
  input: Pick<ContentAnnotationSummaryEmailInput, 'status' | 'succeededCount' | 'failedCount'>
): SummaryEmailHeadlineKind {
  if (input.succeededCount > 0) {
    return input.status === 'completed' ? 'completed' : 'interrupted';
  }
  if (input.status === 'completed' && input.failedCount === 0) {
    return 'no_target';
  }
  return 'failed_all';
}

const HEADLINE_TEXT: Record<SummaryEmailHeadlineKind, string> = {
  completed: 'AI要約が完了しました',
  interrupted: 'AI要約が途中で終了しました',
  no_target: 'AI要約の対象がありませんでした',
  failed_all: 'AI要約を完了できませんでした',
};

function buildSubject(
  kind: SummaryEmailHeadlineKind,
  input: ContentAnnotationSummaryEmailInput
): string {
  if (kind === 'no_target') {
    return `【GrowMate】${HEADLINE_TEXT.no_target}（対象 ${input.totalCount} 件）`;
  }
  return `【GrowMate】${HEADLINE_TEXT[kind]}（成功 ${input.succeededCount} 件 / 対象 ${input.totalCount} 件）`;
}

/** 0 件の区分は行ごと省く。ただし「完了できませんでした」のときだけ「成功 0 件」を明示する */
function buildCountsLine(
  kind: SummaryEmailHeadlineKind,
  input: ContentAnnotationSummaryEmailInput
): string {
  const parts: string[] = [];
  if (input.succeededCount > 0 || kind === 'failed_all') {
    parts.push(`成功 ${input.succeededCount} 件`);
  }
  if (input.failedCount > 0) parts.push(`失敗 ${input.failedCount} 件`);
  if (input.skippedCount > 0) parts.push(`スキップ ${input.skippedCount} 件`);
  if (input.unprocessedCount > 0) parts.push(`未実行 ${input.unprocessedCount} 件`);
  if (parts.length === 0) return `対象 ${input.totalCount} 件です。`;
  return `対象 ${input.totalCount} 件のうち、${parts.join('・')}です。`;
}

/**
 * 失敗理由コードの内訳を件数の多い順に並べる（`describeFailures` と同じ並び）。
 *
 * **辞書に無いコードは落とす。** `failed_by_code` は DB の jsonb で、過去のジョブ行には
 * 現在の集合に無いコードが入りうる。そのまま辞書を引くと `undefined` を描画しようとして
 * 完了メールの組み立てごと落ち、通知が届かなくなる（掃き出しでも毎回同じ行で失敗する）。
 */
function sortedFailureEntries(
  failedByCode: ContentAnnotationSummaryEmailInput['failedByCode']
): [SummaryFailureCode, number][] {
  return Object.entries(failedByCode)
    .filter((entry): entry is [SummaryFailureCode, number] => {
      const [code, count] = entry;
      if ((count ?? 0) <= 0) return false;
      const known = code in FAILURE_NEXT_ACTIONS && code in FAILURE_LABELS;
      if (!known) {
        console.warn('[content-annotation-summary-email] unknown failure code, skipping:', code);
      }
      return known;
    })
    .sort((left, right) => right[1] - left[1]);
}

export function buildContentAnnotationSummaryEmail(
  input: ContentAnnotationSummaryEmailInput
): ContentAnnotationSummaryEmailContent {
  const kind = resolveSummaryEmailHeadlineKind(input);
  const subject = buildSubject(kind, input);

  // リンクは絶対 URL で組む（相対パスはメールクライアントで機能しない）
  const wordpressSetupUrl = `${input.siteUrl}/setup/wordpress`;
  const analyticsUrl = `${input.siteUrl}/analytics`;

  // ブロック3: スキップが1件以上のときだけ出す（同期版トーストと同じ誤読罠を防ぐ）
  const skippedHintBlock =
    input.skippedCount > 0
      ? '<p>スキップは要約の対象外（すでに入力済み、または WordPress 未連携）で、もう一度実行しても変わりません。</p>'
      : '';

  // ブロック4: 失敗が0件のときは見出しごと出さない
  const failureEntries = sortedFailureEntries(input.failedByCode);
  const failureBlock =
    failureEntries.length > 0
      ? `<h2>失敗の内訳</h2>
      <ul>
        ${failureEntries
          .map(([code, count]) => {
            const nextAction = escapeHtml(FAILURE_NEXT_ACTIONS[code]);
            const reauthLink =
              code === 'SUMMARY_WP_REAUTH_REQUIRED'
                ? ` <a href="${wordpressSetupUrl}">GrowMate で再連携する</a>`
                : '';
            return `<li>${escapeHtml(FAILURE_LABELS[code])} ${count} 件 — ${nextAction}${reauthLink}</li>`;
          })
          .join('\n        ')}
      </ul>`
      : '';

  // ブロック5: `failed` のときだけ出す。`completed` に出すと BR-B06 が避けた誤案内になる
  // （背景実行では時間予算切れの継続は cron が行う）。成功0件のときは
  // 「途中までの結果です。」を省く（残せる結果が1件も無いため）
  const resumeBlock =
    input.status === 'failed'
      ? input.succeededCount > 0
        ? '<p>途中までの結果です。もう一度「AIで要約」を実行すると、残りの記事から続けられます。</p>'
        : '<p>もう一度「AIで要約」を実行すると、残りの記事から続けられます。</p>'
      : '';

  const html = `
    <div>
      <h1>${escapeHtml(HEADLINE_TEXT[kind])}</h1>
      <p>${escapeHtml(buildCountsLine(kind, input))}</p>

      ${skippedHintBlock}
      ${failureBlock}
      ${resumeBlock}

      <p><a href="${analyticsUrl}">GrowMate で一覧を見る</a></p>
    </div>
  `;

  return { subject, html: sanitizeEmailHtml(html) };
}
