/**
 * プロンプトの補足説明定数
 * DBに保存せず、UI上で説明を表示するための定数
 */

export interface PromptDescription {
  description: string;
  variables: string;
}

/**
 * google_ads_ai_evaluation テンプレートに暗黙的に注入される変数名一覧
 */
export const IMPLICIT_GOOGLE_ADS_VARS = [
  'persona',
  'strengths',
  'keywordData',
  'negativeKeywords',
  'dateRange',
  'customerName',
] as const;

export const PROMPT_DESCRIPTIONS: Record<string, PromptDescription> = {
  ad_copy_creation: {
    description: 'Google広告やFacebook広告に使用する広告コピーを生成するプロンプト',
    variables: '事業者情報の基本項目（業種、サービス名、ターゲット、エリア）が自動で置換されます',
  },
  lp_draft_creation: {
    description: 'ランディングページの構成と原稿を作成するプロンプト',
    variables:
      '事業者情報に基づいて構造化されたLP原稿を生成します（ヘッダー、問題提起、解決策、特徴、実績、料金、FAQ、CTA）',
  },
  ad_copy_finishing: {
    description: 'ユーザーから入力された広告コピーを修正・改善するプロンプト',
    variables: '事業者情報の全17項目が利用可能です（基本情報、5W2H、ペルソナ、ベンチマーク）',
  },
  blog_creation: {
    description: 'ブログ（記事）の下書きを作成するプロンプト',
    variables: 'canonicalLinkPairs（改行区切りの内部リンク候補「タイトル | URL」一覧）が利用可能です',
  },
  blog_title_meta_generation: {
    description: 'チャットセッションに紐づく記事情報から、SEO向けのタイトル案と説明文案を生成します',
    variables:
      'contentPersona、strength、contentWpContentText、contentMainKw、contentKw を使用します',
  },
  gsc_insight_ctr_boost: {
    description: 'WordPressの記事スニペット（タイトル/ディスクリプション）を改善し、CTR向上案を出します',
    variables:
      'WordPressタイトル（ads_headline相当）、WordPress説明文・抜粋（ads_description相当）、contentMainKw、contentKw、contentWpContentText を使用します',
  },
  gsc_insight_intro_refresh: {
    description: '記事の書き出し（opening_proposal）を改善し、検索意図と読了率を高める案を出します',
    variables:
      '現行の書き出し（opening_proposal）を使用します',
  },
  gsc_insight_body_rewrite: {
    description: '本文全体を意図整合・網羅性観点でリライトする指示セットを出します',
    variables:
      'WordPress本文（wpContent）を使用します',
  },
  google_ads_ai_evaluation: {
    description: 'Google Adsのキーワード指標をAIで分析し、改善提案をメール送信するプロンプト',
    variables: `${IMPLICIT_GOOGLE_ADS_VARS.join('、')} を使用します`,
  },
};

/**
 * プロンプト名から説明を取得
 */
export function getPromptDescription(name: string): PromptDescription | null {
  return PROMPT_DESCRIPTIONS[name] || null;
}

/**
 * 変数の種類別説明
 */
export const VARIABLE_TYPE_DESCRIPTIONS: Record<string, string> = {
  // 基本事業者情報
  business_type: '事業者の業種（例：美容院、税理士事務所、整体院）',
  service_name: '提供するサービス名（例：カット＆カラー、確定申告サポート）',
  target_audience: 'ターゲット顧客層（例：30代女性、中小企業経営者）',
  service_area: 'サービス提供エリア（例：東京都渋谷区、全国対応）',
  differentiation: '競合他社との差別化ポイント',

  // 詳細事業者情報（17項目）
  service: 'サービス内容の詳細説明',
  company: '会社名・屋号',
  address: '所在地（住所）',
  businessHours: '営業時間・定休日',
  tel: '電話番号',
  qualification: '保有資格・認定',
  payments: '対応決済方法',
  strength: '事業の強み・特徴',
  strengths: '全サービスの強み（改行区切り）',
  when: 'いつ（タイミング・期間）',
  where: 'どこで（場所・範囲）',
  who: '誰が（担当者・対象者）',
  why: 'なぜ（理由・目的）',
  what: '何を（商品・サービス内容）',
  how: 'どのように（方法・プロセス）',
  howMuch: 'いくらで（料金・費用）',
  persona: 'ペルソナ情報',
  benchmarkUrl: 'ベンチマークURL（参考サイト）',
  // ブログ作成用（内部リンク候補）
  canonicalLinkPairs: '内部リンク候補の「タイトル | URL」一覧（改行区切り）',
  // ブログ作成用（content_annotations 由来）
  contentNeeds: 'ユーザーのニーズ',
  contentPersona: 'デモグラ・ペルソナ',
  contentGoal: 'ユーザーのゴール',
  contentPrep: 'PREP要約',
  contentBasicStructure: '基本構成',
  contentOpeningProposal: '書き出し案',
  contentMainKw: '主軸キーワード（content_annotations.main_kw）',
  contentKw: '参考キーワード（content_annotations.kw）',
  contentWpContentText: 'WordPress本文テキスト（content_annotations.wp_content_text）',
  // GSC インサイト用
  adsHeadline: 'WordPressタイトル（content_annotations.wp_post_title など）',
  adsDescription: 'WordPress説明文（抜粋/メタディスクリプション想定）',
  openingProposal: 'WordPress記事の書き出し（content_annotations.opening_proposal）',
  wpContent: 'WordPress本文（HTML除去後テキスト）',
  conversionGoal: 'CTA/コンバージョン目標（問い合わせ、購入、予約など）',
  emergingQueries: '新興・ロングテールクエリの一覧や指標',
  competingSnippets: '競合上位ページのスニペット傾向（タイトル/ディスクリプションの特徴）',
  keywordData: 'Google Ads 全キーワードの指標データ（構造化テキスト）',
  negativeKeywords: 'Google Ads 除外キーワード一覧',
  dateRange: '分析対象期間（例: 2026-02-22 〜 2026-03-24）',
  customerName: 'Google Ads アカウント名',
};

/**
 * 変数説明を取得
 */
export function getVariableDescription(variableName: string): string {
  return VARIABLE_TYPE_DESCRIPTIONS[variableName] || `変数: ${variableName}`;
}

/**
 * blog_creation_* テンプレートに暗黙的に注入される content_annotations 由来の変数名一覧
 */
export const IMPLICIT_BLOG_CONTENT_VARS = [
  'contentNeeds',
  'contentPersona',
  'contentGoal',
  'contentPrep',
  'contentBasicStructure',
  'contentOpeningProposal',
] as const;

/**
 * blog_title_meta_generation テンプレートに暗黙的に注入される変数名一覧
 * （content_annotations 由来 + ビジネス情報由来）
 */
export const IMPLICIT_BLOG_TITLE_META_VARS = [
  'contentPersona',
  'contentMainKw',
  'contentKw',
  'contentWpContentText',
  'strength',
] as const;

/**
 * gsc_insight_ctr_boost テンプレートに暗黙的に注入される変数名一覧
 */
export const IMPLICIT_GSC_CTR_BOOST_VARS = [
  'adsHeadline',
  'adsDescription',
  'contentMainKw',
  'contentKw',
  'contentWpContentText',
] as const;
