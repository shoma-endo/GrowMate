import type { CategoryFilterConfig } from '@/types/category';
import type { LinkedMessageRule } from '@/components/LinkedMessage';

// Chat Configuration
export const CHAT_HISTORY_LIMIT = 10; // 件数制限を緩和し、文字数制限(CHAR_LIMIT)を主とする
export const CHAT_HISTORY_CHAR_LIMIT = 30000; // 約20k-30kトークン相当

export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export const GOOGLE_SEARCH_CONSOLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  GA4_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export const GOOGLE_ADS_SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export const GOOGLE_ADS_REAUTH_LINK_RULES: LinkedMessageRule[] = [
  {
    phrase: '設定画面からGoogle Adsを再連携',
    href: '/setup/google-ads',
    variant: 'button-link',
  },
];

// Feature Flags
// AI モデル設定
interface ModelConfig {
  provider: 'openai' | 'anthropic';
  maxTokens: number;
  temperature?: number;
  stream?: boolean;
  actualModel: string;
  seed?: number;
  top_p?: number;
  label?: string; // 人間向けラベル（GSC改善提案で利用）
}

/** GSC本文リライトの出力上限。長時間生成を抑え、個別タイムアウトを守る */
const GSC_SUGGESTION_BODY_MAX_OUTPUT_TOKENS = 16_000;

// 共通設定（DRY原則に基づく定数化）
const ANTHROPIC_BASE = {
  provider: 'anthropic' as const,
  actualModel: 'claude-sonnet-4-6',
  seed: 42,
};

const OPENAI_BASE = {
  provider: 'openai' as const,
  temperature: 0.3,
  seed: 42,
  top_p: 0.95,
};

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2': {
    ...OPENAI_BASE,
    maxTokens: 3000,
    actualModel: 'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2',
  },
  ad_copy_creation: { ...ANTHROPIC_BASE, maxTokens: 4000 },
  lp_draft_creation: { ...ANTHROPIC_BASE, maxTokens: 32000 },
  blog_creation_step1: { ...ANTHROPIC_BASE, maxTokens: 5000 },
  blog_creation_step2: { ...ANTHROPIC_BASE, maxTokens: 5000 },
  blog_creation_step3: { ...ANTHROPIC_BASE, maxTokens: 5000 },
  blog_creation_step4: { ...ANTHROPIC_BASE, maxTokens: 5000 },
  blog_creation_step5: { ...ANTHROPIC_BASE, maxTokens: 6000 },
  blog_creation_step6: { ...ANTHROPIC_BASE, maxTokens: 5000 },
  blog_creation_step7: { ...ANTHROPIC_BASE, maxTokens: 64000 },
  blog_creation_step7_heading: { ...ANTHROPIC_BASE, maxTokens: 7000 },
  blog_title_meta_generation: {
    ...ANTHROPIC_BASE,
    maxTokens: 10000,
  },
  gsc_insight_ctr_boost: {
    ...ANTHROPIC_BASE,
    maxTokens: 4000,
    label: 'タイトル・説明文の提案',
  },
  gsc_insight_intro_refresh: {
    ...ANTHROPIC_BASE,
    maxTokens: 5000,
    label: '書き出し案の提案',
  },
  gsc_insight_body_rewrite: {
    ...ANTHROPIC_BASE,
    maxTokens: GSC_SUGGESTION_BODY_MAX_OUTPUT_TOKENS,
    stream: true,
    label: '本文の提案',
  },
  gsc_insight_persona_rebuild: {
    ...ANTHROPIC_BASE,
    maxTokens: 5000,
    label: 'ペルソナから全て変更',
  },
  google_ads_ai_evaluation: {
    ...ANTHROPIC_BASE,
    // 出力上限。5提案＋サマリー＋末尾JSONで実測〜1万トークン前後のため、約2倍の余裕を確保。
    // 入力（WP在庫50件・GSC順位500件上限）は別途キャップ済みで、コンテキスト窓20万に収まる。
    maxTokens: 20000,
    // SDK のアイドル切断耐性（Anthropic / 中間プロキシ）を確保するためストリーミングで受信する。
    // Vercel 関数自体のタイムアウトは GOOGLE_ADS_AI_EVALUATION_MAX_DURATION_SEC で延伸する。
    stream: true,
    label: 'Google Ads コンテンツ戦略提案',
  },
  google_ads_negative_keywords_suggestion: {
    ...ANTHROPIC_BASE,
    maxTokens: 16000,
    label: 'Google Ads 除外キーワード提案',
  },
  content_annotation_ai_summary: {
    ...ANTHROPIC_BASE,
    maxTokens: 8000,
    label: 'コンテンツ情報のAI要約',
  },
  ga4_content_evaluation: {
    ...ANTHROPIC_BASE,
    maxTokens: 700,
    label: 'コンテンツ評価',
  },
};

/**
 * Google Ads AI 分析 Server Action の Vercel 関数 maxDuration（秒）。
 * Fluid Compute 上限（Pro プランで 800s）を上限にする。
 * page.tsx の `export const maxDuration` と LLM 呼び出しの timeoutMs 算出に共有する単一情報源。
 */
export const GOOGLE_ADS_AI_EVALUATION_MAX_DURATION_SEC = 800;

/**
 * LLM 呼び出し後に必要な処理（順位突合・Markdown→HTML 変換・メール送信・DB 更新）の予算（ミリ秒）。
 * 残り時間から差し引くことで、Vercel ハードキルより手前で AbortError を出させる。
 */
export const GOOGLE_ADS_AI_EVALUATION_POST_LLM_BUFFER_MS = 30_000;

/** content_annotations AI要約: 本文サイズガード（文字数上限） */
export const CONTENT_ANNOTATION_SUMMARY_MAX_CONTENT_CHARS = 80_000;

/** 評価入力の本文削減を開始する予算。要約処理の拒否閾値とは異なる。 */

// =============================================================================
// Blog Creation Steps (単一ソースで一元管理、ステップズレを防止)
// =============================================================================
// 各ステップの id / label / placeholder / model 名を1箇所で定義。
// BLOG_STEP_IDS / BLOG_STEP_LABELS / BLOG_PLACEHOLDERS はここから導出する。

export type BlogStepId = 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7';

/** ブログ作成モデル名のプレフィックス。blog_creation_stepN 等のベース。 */
export const BLOG_MODEL_PREFIX = 'blog_creation_';

/** Step6→Step7 で保存した書き出し案を識別する model 値 */
export const STEP7_LEAD_MODEL = `${BLOG_MODEL_PREFIX}step7_lead`;

/** プレースホルダーキー: step5→6 の AI 取得時（構成案→書き出し案） */
export const STEP6_GET_PLACEHOLDER_KEY = `${BLOG_MODEL_PREFIX}step6_get`;

/** プレースホルダーキー: step7 見出し生成フェーズ */
export const STEP7_HEADING_PLACEHOLDER_KEY = `${BLOG_MODEL_PREFIX}step7_heading`;

/** stepN から blog_creation_stepN モデル名を返す */
export const toBlogModel = (step: BlogStepId) => `${BLOG_MODEL_PREFIX}${step}`;

/** Step7 見出しNのモデル名（blog_creation_step7_h0 等） */
export const getStep7HeadingModel = (index: number) =>
  `${BLOG_MODEL_PREFIX}step7_h${index}`;

/** 見出し単体モデル（blog_creation_step7_hN）かどうか */
export const isStep7HeadingModel = (model?: string) =>
  /^blog_creation_step7_h\d+/.test(model ?? '');

/** Step7 見出し単体生成用の MODEL_CONFIGS キー。blog_creation_step7_h0 等がこの設定（maxTokens: 4000）を参照 */
export const STEP7_HEADING_CONFIG_KEY = 'blog_creation_step7_heading';

/** Step6 モデル（blog_creation_step6 または blog_creation_step6_*）にマッチする正規表現 */
export const STEP6_MODEL_REGEX = /^blog_creation_step6(?:_|$)/;

/** 書き出し案・構成案として有効とみなす最小文字数（ストリーミング中の空メッセージ除外にも使用） */
export const MIN_LEAD_CONTENT_LENGTH = 20;

/** 構成案（基本構成）パターン判定に用いる先頭文字数。BASIC_STRUCTURE_PATTERN のチェック範囲 */
export const STRUCTURE_PATTERN_CHECK_LENGTH = 150;

/** 1ステップ分の定義。プレースホルダーは「このステップの出力を得るための入力」の案内。 */
interface BlogStepDef {
  id: BlogStepId;
  label: string;
  /** 入力→出力の案内。表示中ステップが N-1 のとき、次に取得する stepN のプレースホルダーとして表示。 */
  placeholder: string;
}

const BLOG_STEP_DEFINITIONS: readonly BlogStepDef[] = [
  { id: 'step1', label: '顕在ニーズ・潜在ニーズ確認', placeholder: 'キーワードを入力してください（複数ある場合は改行）。顕在/潜在ニーズを出力します。' },
  { id: 'step2', label: 'ペルソナ・デモグラチェック', placeholder: '顕在/潜在ニーズを入力してください、想定ペルソナ/デモグラを出力します。' },
  { id: 'step3', label: 'ユーザーのゴール', placeholder: '想定ペルソナ/デモグラを入力してください、ユーザーのゴールを出力します。' },
  { id: 'step4', label: 'PREPチェック', placeholder: 'ユーザーのゴールを入力してください、PREP（主張・理由・具体例・結論）を出力します。' },
  { id: 'step5', label: '構成案確認', placeholder: 'PREP（主張・理由・具体例・結論）を入力してください、構成案を出力します。' },
  { id: 'step6', label: '書き出し案', placeholder: '書き出し案を入力して送信すると、見出し生成に進みます。' },
  { id: 'step7', label: '本文作成', placeholder: '書き出し案を入力して送信すると、見出し1から始まります。' },
];

export const BLOG_STEP_IDS: BlogStepId[] = BLOG_STEP_DEFINITIONS.map(d => d.id);

export const BLOG_STEP_LABELS: Record<BlogStepId, string> = Object.fromEntries(
  BLOG_STEP_DEFINITIONS.map((d, i) => [d.id, `${i + 1}. ${d.label}`])
) as Record<BlogStepId, string>;

/** blog_creation_stepN のプレースホルダー（通常フロー）。step6_get / step7_heading は別途マージ。 */
const BLOG_PLACEHOLDERS_BASE: Record<string, string> = Object.fromEntries(
  BLOG_STEP_DEFINITIONS.map(d => [toBlogModel(d.id), d.placeholder])
);

export const BLOG_PLACEHOLDERS: Record<string, string> = {
  ...BLOG_PLACEHOLDERS_BASE,
  [STEP6_GET_PLACEHOLDER_KEY]: '構成案を入力してください、書き出し案を出力します。',
  [STEP7_HEADING_PLACEHOLDER_KEY]: '見出し生成・保存ボタンで進めてください',
};

/** Step7（本文作成）のステップID。見出し単位生成フロー・完成形作成が紐づく。BLOG_STEP_IDS の最終要素 */
export const STEP7_ID: BlogStepId = BLOG_STEP_IDS[BLOG_STEP_IDS.length - 1] as BlogStepId;

/** Step7 本文作成のモデル名（blog_creation_step7）。複数箇所での比較に再利用 */
export const STEP7_BLOG_MODEL = toBlogModel(STEP7_ID);

/** Step5（構成案）のステップID。step5→6 の AI 取得時プレースホルダー判定等で使用。BLOG_STEP_IDS から導出 */
export const STEP5_ID: BlogStepId = BLOG_STEP_IDS[4] as BlogStepId;

/** Step6（書き出し案）のステップID。Step6→7 遷移判定等で使用。BLOG_STEP_IDS から導出 */
export const STEP6_ID: BlogStepId = BLOG_STEP_IDS[5] as BlogStepId;

/** 初期ステップID（フォールバック用）。BLOG_STEP_IDS の先頭要素（step1） */
export const FIRST_BLOG_STEP_ID: BlogStepId = BLOG_STEP_IDS[0] as BlogStepId;

/**
 * StepActionBar「現在のステップ」表示用。ステップごとの完全な固定文言（普遍）。
 * step7 は見出しフェーズで「見出し X/Y」を動的追記するためベースのみ。
 */
export const BLOG_STEP_ACTION_BAR_FULL_TEXT: Record<BlogStepId, string> = {
  step1: '現在のステップ: 1. 顕在ニーズ・潜在ニーズ確認／次のペルソナ・デモグラチェックに進むにはメッセージを送信してください',
  step2: '現在のステップ: 2. ペルソナ・デモグラチェック／次のユーザーのゴールに進むにはメッセージを送信してください',
  step3: '現在のステップ: 3. ユーザーのゴール／次のPREPチェックに進むにはメッセージを送信してください',
  step4: '現在のステップ: 4. PREPチェック／次の構成案確認に進むにはメッセージを送信してください',
  step5: '現在のステップ: 5. 構成案確認／次の書き出し案に進むにはメッセージを送信してください',
  step6: '現在のステップ: 6. 書き出し案／次の本文作成に進むにはメッセージを送信してください',
  step7: '現在のステップ: 7. 本文作成',
};

/** Step7 見出し未検出時の共通案内メッセージ */
export const STEP7_BASIC_STRUCTURE_SAVE_MESSAGE =
  '見出しが見つかりません。メモ・補足情報の「基本構成」に h2/h3/h4 形式で見出しを保存してください。';

// Step7判定（canonicalUrlsの適用/表示で利用）
export const isStep7 = (stepOrModel: string) =>
  stepOrModel === STEP7_ID || stepOrModel === toBlogModel(STEP7_ID);

/** Step7 本文生成: 楽観的表示・API送信・DB保存で使う短いトリガー（長文はシステムプロンプトのみに渡す） */
export const STEP7_FULL_BODY_TRIGGER = '完成形記事本文を生成してください。';



export const ANALYTICS_COLUMNS = [
  { id: 'main_kw', label: '主軸kw' },
  { id: 'kw', label: 'kw（参考）' },
  { id: 'impressions', label: '検索結果に出た回数' },
  { id: 'ga4_avg_engagement_time', label: '滞在時間(平均)' },
  { id: 'ga4_read_rate', label: '読了率' },
  { id: 'ga4_engagement_rate', label: '読み始め率' },
  { id: 'ga4_evaluation_status', label: 'コンテンツ評価状態' },
  { id: 'ga4_content_score', label: 'コンテンツ力スコア' },
  { id: 'ga4_diagnosis', label: '診断' },
  { id: 'ga4_last_evaluated_at', label: '最終評価日時' },
  { id: 'ga4_cv_count', label: '問い合わせ数' },
  { id: 'ga4_cvr', label: '問い合わせ率' },
  { id: 'ga4_flags', label: 'GA4状態' },
  { id: 'needs', label: 'ニーズ' },
  { id: 'persona', label: 'デモグラ・ペルソナ' },
  { id: 'goal', label: 'ゴール' },
  { id: 'prep', label: 'PREP' },
  { id: 'basic_structure', label: '基本構成' },
  { id: 'opening_proposal', label: '書き出し案' },
  { id: 'categories', label: 'カテゴリ' },
  { id: 'wp_post_title', label: 'WordPressタイトル' },
  { id: 'wp_excerpt', label: 'WordPress説明文' },
  { id: 'url', label: 'URL' },
];

// Analytics ページの localStorage キー
export const ANALYTICS_STORAGE_KEYS = {
  CATEGORY_FILTER: 'analytics.categoryFilter',
  OPS_EXPANDED: 'analytics.opsExpanded',
  VISIBLE_COLUMNS: 'analytics.visibleColumns',
  IG_VISIBLE_COLUMNS: 'analytics.instagramVisibleColumns',
} as const;

// Next.js の route segment config は静的解析のため import 定数を使えず、
// app/analytics/page.tsx の maxDuration はリテラル必須。値はここと必ず一致させること（他ファイルから import しない）。
const INSTAGRAM_SYNC_MAX_DURATION_SEC = 800;
// maxDuration より 40 秒短く（レスポンス返却の余裕。gscEvaluationService の 280/300 秒比を踏襲）。
export const INSTAGRAM_SYNC_TIME_BUDGET_MS = (INSTAGRAM_SYNC_MAX_DURATION_SEC - 40) * 1000;
export const INSTAGRAM_SYNC_MEDIA_LIMIT = 50;
export const INSTAGRAM_SYNC_CONSECUTIVE_FAILURE_LIMIT = 5;
export const INSTAGRAM_RATE_CALL_COUNT_THRESHOLD = 80;

// docs/plans/instagram-media-url-refresh-design.md §4.3。
// 非公開バケット。Service Role（Route Handler 経由）以外からのアクセスは行わない。
export const INSTAGRAM_MEDIA_THUMBNAIL_BUCKET = 'instagram-media-thumbnails';

// Instagram のメディア・サムネイル配信元となる CDN ホスト（ベースドメインのみ）。
// 参照元（各自ワイルドカード記法が異なるため、この配列から個別に組み立てる）:
//   - proxy.ts の buildCspHeader（img-src。`https://*.<host>` 形式）
//   - app/api/instagram/media/[igMediaId]/thumbnail/route.ts の ALLOWED_IMAGE_HOSTS（SSRF 対策の許可ホスト正規表現）
//   - next.config.ts の images.remotePatterns（`**.<host>` 形式。next.config.ts は Next 起動時に
//     alias 解決前に読まれるため `@/` import を使わず、この配列とのコメントによる手動同期のみ）
export const INSTAGRAM_CDN_HOSTS = ['cdninstagram.com', 'fbcdn.net'] as const;

export const INSTAGRAM_COLUMNS = [
  { id: 'media_product_type', label: '種別', defaultVisible: true },
  { id: 'caption', label: 'キャプション', defaultVisible: true },
  { id: 'posted_at', label: '投稿日', defaultVisible: true },
  { id: 'reach', label: 'リーチ', defaultVisible: true },
  { id: 'views', label: '視聴数', defaultVisible: true },
  { id: 'like_count', label: 'いいね', defaultVisible: true },
  { id: 'comments_count', label: 'コメント', defaultVisible: true },
  { id: 'saved', label: '保存', defaultVisible: true },
  { id: 'shares', label: 'シェア', defaultVisible: false },
  { id: 'reposts', label: '再投稿', defaultVisible: false },
  { id: 'total_interactions', label: '総インタラクション', defaultVisible: false },
  { id: 'avg_watch_time_ms', label: '平均視聴時間', defaultVisible: false },
  { id: 'total_watch_time_ms', label: '総再生時間', defaultVisible: false },
  { id: 'reels_skip_rate', label: 'スキップ率', defaultVisible: false },
  { id: 'like_rate', label: 'いいね率', defaultVisible: false },
  { id: 'saved_rate', label: '保存率', defaultVisible: false },
  { id: 'share_rate', label: 'シェア率', defaultVisible: false },
  { id: 'comment_rate', label: 'コメント率', defaultVisible: false },
  { id: 'repost_rate', label: '再投稿率', defaultVisible: false },
] as const;

// カテゴリフィルターのデフォルト値
const DEFAULT_CATEGORY_FILTER: CategoryFilterConfig = {
  selectedCategoryNames: [],
  includeUncategorized: false,
};

// localStorageからカテゴリフィルターを読み込むヘルパー
export function loadCategoryFilterFromStorage(): CategoryFilterConfig {
  if (typeof window === 'undefined') return DEFAULT_CATEGORY_FILTER;
  try {
    const stored = localStorage.getItem(ANALYTICS_STORAGE_KEYS.CATEGORY_FILTER);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        selectedCategoryNames: Array.isArray(parsed.selectedCategoryNames)
          ? parsed.selectedCategoryNames
          : [],
        includeUncategorized:
          typeof parsed.includeUncategorized === 'boolean' ? parsed.includeUncategorized : false,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_CATEGORY_FILTER;
}

/**
 * /ga4-dashboard 記事別ランキングの1ページ件数。
 *
 * 集計は DB 側の `get_ga4_dashboard_ranking` が limit/offset を適用する。
 * 上限は RPC 側でも 100 に制限しているため、これを超える値を渡さないこと。
 */
export const GA4_RANKING_PAGE_SIZE = 20;
