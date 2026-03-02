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
// Blog Creation Steps (centralized definitions)
// =============================================================================

/** 見出し単位生成フローが紐づくステップID */
export const HEADING_FLOW_STEP_ID: BlogStepId = 'step7';

export type BlogStepId = 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7';

export const BLOG_STEP_IDS: BlogStepId[] = [
  'step1',
  'step2',
  'step3',
  'step4',
  'step5',
  'step6',
  'step7',
];

export const BLOG_STEP_LABELS: Record<BlogStepId, string> = {
  step1: '1. 顕在ニーズ・潜在ニーズ確認',
  step2: '2. ペルソナ・デモグラチェック',
  step3: '3. ユーザーのゴール',
  step4: '4. PREPチェック',
  step5: '5. 構成案確認',
  step6: '6. 書き出し案',
  step7: '7. 本文作成',
};

// Step7判定（canonicalUrlsの適用/表示で利用）
export const isStep7 = (stepOrModel: string) =>
  stepOrModel === HEADING_FLOW_STEP_ID || stepOrModel === `blog_creation_${HEADING_FLOW_STEP_ID}`;

export const BLOG_PLACEHOLDERS: Record<string, string> = {
  blog_creation_step1: '顕在/潜在ニーズの内容を入力してください',
  blog_creation_step2: '想定ペルソナ/デモグラの内容を入力してください',
  blog_creation_step3: 'ユーザーのゴールに関する内容を入力してください',
  blog_creation_step4: 'PREP（主張・理由・具体例・結論）の確認事項を入力してください',
  blog_creation_step5: '構成案確認内容を入力してください',
  blog_creation_step6: '書き出し案を入力してください',
  blog_creation_step7: '本文作成の要件/トーンを入力してください',
};

// prompts.ts 用のテンプレ名解決
export const toTemplateName = (step: BlogStepId) => `blog_creation_${step}`;

/** ステップバーに表示するヒントテキスト。null = デフォルト（次ステップ名を使った汎用テキスト） */
export const BLOG_STEP_HINTS: Partial<Record<BlogStepId, string>> = {
  step5: '構成案を「この内容で保存」で確定するか、メッセージを送信して次の「書き出し案」へ',
};

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
