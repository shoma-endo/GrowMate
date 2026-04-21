/**
 * Google Ads キーワードのマッチタイプ
 */
export type GoogleAdsMatchType = 'EXACT' | 'PHRASE' | 'BROAD';

/**
 * Google Ads エンティティのステータス
 */
export type GoogleAdsStatus = 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN';

/**
 * Google Ads キャンペーンのステータス
 */
export type GoogleAdsCampaignStatus = Extract<GoogleAdsStatus, 'ENABLED' | 'PAUSED'>;

/**
 * Google Ads キーワードのステータス
 */
export type GoogleAdsKeywordStatus = Extract<GoogleAdsStatus, 'ENABLED' | 'PAUSED' | 'REMOVED'>;

/**
 * Google Ads キーワード指標
 * keyword_view から取得する広告パフォーマンス指標
 */
export interface GoogleAdsKeywordMetric {
  /** キーワード ID（ad_group_criterion.criterion_id） */
  keywordId: string;
  /** キーワードテキスト */
  keywordText: string;
  /** マッチタイプ */
  matchType: GoogleAdsMatchType;
  /** キャンペーン名 */
  campaignName: string;
  /** 広告グループ名 */
  adGroupName: string;
  /** キーワードのステータス */
  status: GoogleAdsKeywordStatus | 'UNKNOWN';

  // ===== 7つの主要指標 =====
  /** CTR（クリック率）: 0〜1 の割合 */
  ctr: number;
  /** CPC（平均クリック単価）: 円換算済み */
  cpc: number;
  /** 品質スコア: 1〜10、未算出の場合は null */
  qualityScore: number | null;
  /** コンバージョン数 */
  conversions: number;
  /** コンバージョン単価: 円換算済み、コンバージョンがない場合は null */
  costPerConversion: number | null;
  /** 検索インプレッションシェア: 0〜1 の割合、未算出の場合は null */
  searchImpressionShare: number | null;
  /** コンバージョン率: 0〜1 の割合 */
  conversionRate: number | null;

  // ===== 補助指標 =====
  /** インプレッション数（表示回数） */
  impressions: number;
  /** クリック数 */
  clicks: number;
  /** コスト（費用）: 円換算済み */
  cost: number;
}

/**
 * キーワード指標取得の入力パラメータ
 */
export interface GetKeywordMetricsInput {
  /** Google OAuth アクセストークン */
  accessToken: string;
  /** Google Ads カスタマー ID（ハイフンなし 10桁） */
  customerId: string;
  /** 開始日（YYYY-MM-DD 形式） */
  startDate: string;
  /** 終了日（YYYY-MM-DD 形式） */
  endDate: string;
  /** キャンペーン ID でフィルタ（任意） */
  campaignIds?: string[];
  /** 全ステータスのキーワードを取得するか */
  includeAllStatuses?: boolean;
  /** MCC（マネージャー）アカウントID（ハイフンなし 10桁）を login-customer-id ヘッダーに設定（任意） */
  loginCustomerId?: string;
}

/**
 * キーワード指標取得の結果
 */
export interface GetKeywordMetricsResult {
  success: boolean;
  data?: GoogleAdsKeywordMetric[];
  error?: string;
}

/**
 * Google Ads 除外キーワード
 */
export interface GoogleAdsNegativeKeyword {
  /** 除外キーワードのテキスト */
  keywordText: string;
  /** 除外キーワードのマッチタイプ */
  matchType: GoogleAdsMatchType;
  /** 除外キーワードが設定されているレベル */
  level: 'campaign' | 'ad_group';
  /** 対象キャンペーン名 */
  campaignName: string;
  /** 対象広告グループ名（広告グループレベル除外時のみ） */
  adGroupName?: string;
}

/**
 * 除外キーワード取得の結果
 */
export interface GetNegativeKeywordsResult {
  /** 取得処理が成功したか */
  success: boolean;
  /** 取得した除外キーワード一覧 */
  data?: GoogleAdsNegativeKeyword[];
  /** 失敗時のエラーメッセージ */
  error?: string;
}

/**
 * Google Ads 連携解除の結果
 */
export interface DisconnectGoogleAdsResult {
  success: boolean;
  error?: string;
}

/**
 * Google Ads API の searchStream レスポンス行
 */
export interface GoogleAdsSearchStreamRow {
  adGroupCriterion?: {
    criterionId?: string;
    status?: GoogleAdsStatus;
    keyword?: {
      text?: string;
      matchType?: string;
    };
    qualityInfo?: {
      qualityScore?: number;
    };
  };
  campaignCriterion?: {
    keyword?: {
      text?: string;
      matchType?: string;
    };
  };
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
  };
  adGroup?: {
    name?: string;
    status?: GoogleAdsStatus;
  };
  metrics?: {
    ctr?: number;
    averageCpc?: string; // micros (string)
    // historicalQualityScore?: number; // removed in favor of ad_group_criterion.quality_info.quality_score
    conversions?: number;
    costPerConversion?: string; // micros (string)
    searchImpressionShare?: number;
    conversionsFromInteractionsRate?: number;
    impressions?: string;
    clicks?: string;
    costMicros?: string;
  };
  customerClient?: {
    resourceName?: string;
    clientCustomer?: string;
    level?: number;
    timeZone?: string;
    testAccount?: boolean;
    manager?: boolean;
    descriptiveName?: string;
    descriptive_name?: string; // API response sometimes uses snake_case
    currencyCode?: string;
    id?: number;
  };
}

/**
 * Google Ads API のエラーレスポンス
 */
export interface GoogleAdsApiError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      '@type'?: string;
      errors?: Array<{
        errorCode?: Record<string, string>;
        message?: string;
      }>;
    }>;
  };
}

/**
 * キャンペーン単位の集計指標
 * keyword_view から取得したデータをキャンペーン単位で集計した結果
 */
export interface GoogleAdsCampaignMetrics {
  /** キャンペーン ID */
  campaignId: string;
  /** キャンペーン名 */
  campaignName: string;
  /** ステータス */
  status: GoogleAdsCampaignStatus;
  /** クリック数 */
  clicks: number;
  /** 表示回数 */
  impressions: number;
  /** 費用（円） */
  cost: number;
  /** CTR（クリック率）: 0〜1 の割合 */
  ctr: number;
  /** CPC（平均クリック単価）: 円 */
  cpc: number;
  /** 品質スコア（キャンペーン内の平均）: 1〜10、未算出の場合は null */
  qualityScore: number | null;
  /** コンバージョン数 */
  conversions: number;
  /** コンバージョン単価: 円、コンバージョンがない場合は null */
  costPerConversion: number | null;
  /** 検索インプレッションシェア: 0〜1 の割合、未算出の場合は null */
  searchImpressionShare: number | null;
  /** コンバージョン率: 0〜1 の割合 */
  conversionRate: number | null;
}

/**
 * キャンペーン集計のサマリー指標
 */
export interface GoogleAdsCampaignSummary {
  totalClicks: number;
  totalImpressions: number;
  totalCost: number;
  totalConversions: number;
  avgCtr: number;
  avgCpc: number;
  avgConversionRate: number;
  avgCostPerConversion: number;
  avgSearchImpressionShare: number | null;
}

/**
 * キャンペーン指標取得の結果
 */
export interface GetCampaignMetricsResult {
  success: boolean;
  data?: GoogleAdsCampaignMetrics[];
  error?: string;
}

/**
 * Google Ads ダッシュボードのエラー種別
 */
export type GoogleAdsErrorKind =
  | 'not_connected'
  | 'not_selected'
  | 'auth_expired'
  | 'admin_required'
  | 'unknown';
