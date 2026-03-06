import type { CategoryFilterConfig } from '@/types/category';

export const ERROR_MESSAGES = {
  ad_not_found: 'この検索キーワードでは広告情報が見つかりませんでした。',
  daily_chat_limit:
    '本日のチャット利用上限（3回）に達しました。上限は日本時間の00:00にリセットされます。',
  // サービス選択関連
  service_not_found: '指定されたサービスが見つかりません。事業者情報を確認してください。',
  service_selection_required: 'サービスを選択してください。',
};

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

// Feature Flags
// AI モデル設定
interface ModelConfig {
  provider: 'openai' | 'anthropic';
  maxTokens: number;
  temperature: number;
  actualModel: string;
  seed?: number;
  top_p?: number;
  label?: string; // 人間向けラベル（GSC改善提案で利用）
}

// 共通設定（DRY原則に基づく定数化）
const ANTHROPIC_BASE = {
  provider: 'anthropic' as const,
  temperature: 0.3,
  actualModel: 'claude-sonnet-4-5-20250929',
  seed: 42,
};

const ANTHROPIC_HAIKU_BASE = {
  ...ANTHROPIC_BASE,
  actualModel: 'claude-haiku-4-5-20251001',
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
  ad_copy_finishing: { ...ANTHROPIC_BASE, maxTokens: 4000 },
  lp_draft_creation: { ...ANTHROPIC_BASE, maxTokens: 14000 },
  lp_improvement: { ...ANTHROPIC_BASE, maxTokens: 12000 },
  // ブログ作成ステップ（共通設定を適用し、maxTokensのみ個別指定）
  blog_creation_step1: { ...ANTHROPIC_BASE, maxTokens: 4000 },
  blog_creation_step2: { ...ANTHROPIC_BASE, maxTokens: 4000 },
  blog_creation_step3: { ...ANTHROPIC_BASE, maxTokens: 4000 },
  blog_creation_step4: { ...ANTHROPIC_BASE, maxTokens: 4000 },
  blog_creation_step5: { ...ANTHROPIC_BASE, maxTokens: 5000 },
  blog_creation_step6: { ...ANTHROPIC_BASE, maxTokens: 4000 },
  blog_creation_step7: { ...ANTHROPIC_BASE, maxTokens: 20000 },
  blog_title_meta_generation: {
    ...ANTHROPIC_HAIKU_BASE,
    maxTokens: 2000,
  },
  gsc_insight_ctr_boost: {
    ...ANTHROPIC_HAIKU_BASE,
    maxTokens: 4000,
    label: 'タイトル・説明文の提案',
  },
  gsc_insight_intro_refresh: {
    ...ANTHROPIC_HAIKU_BASE,
    maxTokens: 5000,
    label: '書き出し案の提案',
  },
  gsc_insight_body_rewrite: {
    ...ANTHROPIC_HAIKU_BASE,
    maxTokens: 10000,
    label: '本文の提案',
  },
  gsc_insight_persona_rebuild: {
    ...ANTHROPIC_HAIKU_BASE,
    maxTokens: 5000,
    label: 'ペルソナから全て変更',
  },
};

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

/** Step6 モデル（blog_creation_step6 または blog_creation_step6_*）にマッチする正規表現 */
export const STEP6_MODEL_REGEX = /^blog_creation_step6(?:_|$)/;

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

/** 見出し単位生成フローが紐づくステップID。BLOG_STEP_IDS の最終要素（step7） */
export const HEADING_FLOW_STEP_ID: BlogStepId = BLOG_STEP_IDS[BLOG_STEP_IDS.length - 1] as BlogStepId;

/** Step7 本文作成のモデル名（blog_creation_step7）。複数箇所での比較に再利用 */
export const STEP7_BLOG_MODEL = toBlogModel(HEADING_FLOW_STEP_ID);

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

// Step7判定（canonicalUrlsの適用/表示で利用）
export const isStep7 = (stepOrModel: string) =>
  stepOrModel === HEADING_FLOW_STEP_ID || stepOrModel === toBlogModel(HEADING_FLOW_STEP_ID);

/** Step7 本文生成: 楽観的表示・API送信・DB保存で使う短いトリガー（長文はシステムプロンプトのみに渡す） */
export const STEP7_FULL_BODY_TRIGGER = '完成形記事本文を生成してください。';

// prompts.ts 用のテンプレ名解決（toBlogModel のエイリアス）
export const toTemplateName = toBlogModel;


export const ANALYTICS_COLUMNS = [
  { id: 'main_kw', label: '主軸kw' },
  { id: 'kw', label: 'kw（参考）' },
  { id: 'impressions', label: '表示回数' },
  { id: 'ga4_avg_engagement_time', label: '滞在時間(平均)' },
  { id: 'ga4_read_rate', label: '読了率' },
  { id: 'ga4_bounce_rate', label: '直帰率' },
  { id: 'ga4_cv_count', label: 'CV数' },
  { id: 'ga4_cvr', label: 'CVR' },
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
} as const;

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
