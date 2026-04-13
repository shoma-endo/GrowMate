/**
 * アプリケーション全体のエラーメッセージ定義
 *
 * エラーメッセージをカテゴリ別に一元管理することで：
 * - 文言の一貫性を保証
 * - 修正が一箇所で完結
 * - タイポや文言ブレを防止
 * - 拡張性を確保
 */

/** URL形式不正（WordPress・バリデーション共通） */
const INVALID_URL = '有効なURLを入力してください';

export const ERROR_MESSAGES = {
  /**
   * WordPress関連のエラーメッセージ
   */
  WORDPRESS: {
    /** WordPress設定が未登録・未完了の場合 */
    SETTINGS_INCOMPLETE:
      'WordPress設定が未完了です。設定ダッシュボードで接続設定を確認してください。',

    /** WordPress設定が登録されていない場合 */
    SETTINGS_NOT_REGISTERED: 'WordPress設定が登録されていません',

    /** WordPress設定が登録されていない場合（詳細） */
    SETTINGS_NOT_REGISTERED_DETAIL:
      'WordPress設定が登録されていません。設定画面から連携を完了してください。',

    /** WordPress投稿タイプの取得に失敗した場合 */
    CONTENT_TYPE_FETCH_FAILED:
      'WordPressの投稿タイプを取得できませんでした。設定ダッシュボードでWordPress接続設定を確認してください。',

    /** WordPressへの接続に失敗した場合（汎用） */
    CONNECTION_FAILED:
      'WordPressへの接続に失敗しました。設定ダッシュボードで接続設定を確認してください。',

    /** WordPress投稿の取得に失敗した場合 */
    POSTS_FETCH_FAILED:
      'WordPress投稿の取得に失敗しました。設定ダッシュボードで接続設定を確認してください。',

    /** WordPress投稿取得エラー（HTTPステータス付き） */
    POSTS_FETCH_ERROR_HTTP: (status: number, errorText: string): string =>
      `WordPress投稿取得エラー: HTTP ${status} ${errorText}`,

    /** 接続テスト中のエラー */
    CONNECTION_TEST_ERROR: '接続テスト中に予期せぬエラーが発生しました',

    /** WordPress設定の保存に失敗した場合 */
    SETTINGS_SAVE_FAILED: 'WordPress設定の保存に失敗しました',

    /** サーバーエラー（WordPress関連） */
    SERVER_ERROR: 'サーバーエラーが発生しました',

    /** WordPress.com連携は管理者のみ利用可能 */
    WORDPRESS_COM_ADMIN_ONLY: 'WordPress.com 連携は管理者のみ利用できます',

    /** セルフホストWordPressに必要な情報が不足している場合 */
    SELF_HOSTED_REQUIRED_FIELDS:
      'セルフホストWordPressには、サイトURL、ユーザー名、およびアプリケーションパスワードが必要です',

    /** WordPress.comにサイトIDが必要な場合 */
    WORDPRESS_COM_SITE_ID_REQUIRED: 'WordPress.com連携にはサイトIDが必要です',

    /** 有効なURLを入力してください */
    INVALID_URL,

    /** 指定された投稿IDがWordPressで見つからない場合 */
    POST_ID_NOT_FOUND: '指定された投稿IDがWordPressで見つかりませんでした。URLをご確認ください。',

    /** URLから投稿IDを特定できない場合 */
    POST_ID_CANNOT_BE_RESOLVED:
      'URLから投稿IDを特定できませんでした。編集URLまたは公開URLを入力してください。',

    /** WordPressで該当する投稿が見つからない場合 */
    POST_NOT_FOUND: 'WordPressで該当する投稿が見つかりませんでした。URLをご確認ください。',

    /** 重複するcanonical URLエラー */
    DUPLICATE_CANONICAL: 'このWordPress記事URLは別のコンテンツで既に登録されています',

    /** 既存アノテーション取得エラー */
    ANNOTATION_FETCH_ERROR: (message: string): string => `既存アノテーション取得エラー: ${message}`,

    /** WordPressコンテンツの取得中にエラーが発生 */
    CONTENT_FETCH_ERROR: 'WordPressコンテンツの取得中にエラーが発生しました',

    /** インポート処理中にエラーが発生 */
    IMPORT_ERROR: 'インポート処理中にエラーが発生しました',

    /** 全ての更新が失敗した場合 */
    ALL_UPDATES_FAILED: (failures: string[]): string =>
      `全ての更新が失敗しました: ${failures.slice(0, 3).join('; ')}${
        failures.length > 3 ? '...' : ''
      }`,

    /** コンテンツの削除に失敗 */
    CONTENT_DELETE_FAILED: 'コンテンツの削除に失敗しました',

    /** アノテーションIDが無効 */
    INVALID_ANNOTATION_ID: 'アノテーションIDが無効です',

    /** WordPress設定保存成功時 */
    SETTINGS_SAVED: 'WordPress設定を保存しました',

    /** 接続テスト中に予期しないエラーが発生した場合 */
    TEST_CONNECTION_UNEXPECTED: '接続テスト中に予期しないエラーが発生しました',
  },

  /**
   * 認証関連のエラーメッセージ
   */
  AUTH: {
    /** 認証に失敗した場合 */
    AUTH_FAILED: '認証に失敗しました。再度ログインしてください。',

    /** ログインしていない場合 */
    NOT_LOGGED_IN: 'ログインしていません',

    /** ユーザー認証に失敗した場合 */
    USER_AUTH_FAILED: 'ユーザー認証に失敗しました',

    /** 認証エラーが発生した場合 */
    AUTH_ERROR: '認証エラーが発生しました',

    /** 認証エラー（汎用） */
    AUTH_ERROR_GENERIC: '認証エラー',

    /** LINE認証が必要な場合 */
    LINE_AUTH_REQUIRED: 'LINE認証が必要です',

    /** 認証が必要な場合 */
    AUTHENTICATION_REQUIRED: '認証が必要か、必須項目が不足しています',

    /** 認証に失敗した場合 */
    AUTHENTICATION_FAILED: '認証に失敗しました',

    /** 未認証エラー */
    UNAUTHENTICATED: '未認証',

    /** 再認証が必要な場合 */
    REAUTHENTICATION_REQUIRED: '再認証が必要です',

    /** 権限がない場合 */
    UNAUTHORIZED: '権限がありません',

    /** アクセス権の確認に失敗した場合 */
    ACCESS_CHECK_FAILED: 'アクセス権の確認に失敗しました',

    /** オーナー権限が必要な場合 */
    OWNER_REQUIRED: 'この操作はオーナー権限が必要です',

    /** スタッフユーザーが操作できない場合 */
    STAFF_OPERATION_NOT_ALLOWED: 'スタッフユーザーはこの操作を実行できません',

    /** View Mode中のオーナーとスタッフが操作できない場合（本人のオーナーアカウントのみ許可） */
    OWNER_ACCOUNT_REQUIRED: 'この操作は本人のオーナーアカウントでのみ実行できます',

    /** LINEのアクセストークンが必要な場合 */
    LINE_ACCESS_TOKEN_REQUIRED: 'LINEのアクセストークンが必要です',

    /** 認証情報が無効または期限切れの場合 */
    LINE_TOKEN_INVALID_OR_EXPIRED: '認証情報が無効または期限切れです。再度ログインしてください。',

    /** LINEプロフィールの取得に失敗した場合 */
    LINE_PROFILE_FETCH_FAILED: 'LINEのプロフィール情報の取得に失敗しました',

    /** LINEユーザーに対応するアプリユーザーが見つからない場合 */
    LINE_USER_NOT_FOUND: 'このLINEユーザーに対応するアプリユーザーが見つかりません',

    /** LINEトークンの更新に失敗した場合 */
    LINE_TOKEN_REFRESH_FAILED: 'LINEトークンの更新に失敗しました',

    /** LINEトークンの取得に失敗した場合 */
    LINE_TOKEN_FETCH_FAILED: 'LINEトークンの取得に失敗しました',

    /** 認証されていない場合（check-role等） */
    NOT_AUTHENTICATED: '認証されていません',

    /** 同一メールの public.users 行が既に別の Supabase Auth とリンク済み（無条件上書きしない） */
    EMAIL_LINK_CONFLICT:
      'このメールアドレスは別のログインと既に紐づいています。サポートへお問い合わせください。',

    /** トークン期限切れで再ログインが必要な場合 */
    TOKEN_EXPIRED_REAUTH: 'トークンの有効期限が切れました。再度ログインしてください',

    /** ユーザー権限の取得に失敗した場合 */
    USER_ROLE_FETCH_FAILED: 'ユーザー権限の取得に失敗しました',

    /** OAuthの初期化に失敗した場合 */
    OAUTH_INIT_FAILED: 'OAuthの初期化に失敗しました',

    /** OAuth設定エラー */
    OAUTH_CONFIG_ERROR: 'OAuthの設定エラーが発生しました',

    /** OAuth処理中にサーバーエラーが発生した場合 */
    OAUTH_CALLBACK_SERVER_ERROR: 'OAuth処理中にサーバーエラーが発生しました',

    /** セッションが無効な場合（CSRF対策） */
    INVALID_STATE: 'セッションが無効です。再度お試しください',

    /** セッション情報が無効な場合 */
    INVALID_STATE_PAYLOAD: 'セッション情報が無効です',

    /** OAuthセッションが無効な場合 */
    OAUTH_SESSION_INVALID: 'OAuthセッションが無効です',

    /** 認証コードが取得できなかった場合 */
    AUTHORIZATION_CODE_MISSING: '認証コードが取得できませんでした',

    /** アクセストークンの取得に失敗した場合 */
    ACCESS_TOKEN_FETCH_FAILED: 'アクセストークンの取得に失敗しました',

    /** 閲覧モードの利用権限がない場合 */
    VIEW_MODE_UNAUTHORIZED: '閲覧モードの利用権限がありません',

    /** 閲覧対象のユーザーが見つからない場合 */
    VIEW_MODE_USER_NOT_FOUND: '閲覧対象のユーザーが見つかりません',

    /** ユーザー閲覧権限がない場合 */
    VIEW_USER_UNAUTHORIZED: 'このユーザーを閲覧する権限がありません',

    /** 閲覧モードのユーザー情報の取得に失敗した場合 */
    VIEW_MODE_FETCH_FAILED: '閲覧モードのユーザー情報の取得に失敗しました',

    /** リフレッシュトークンが見つからない場合 */
    NO_REFRESH_TOKEN: 'リフレッシュトークンが見つかりません',

    /** リフレッシュトークンが無効な場合 */
    REFRESH_TOKEN_INVALID: 'リフレッシュトークンが無効です',
  },

  /**
   * バリデーション用エラーメッセージ（サーバー・クライアント共通）
   * lib/validators/common.ts および各種フォームで使用
   */
  VALIDATION: {
    /** タイトル未入力 */
    TITLE_REQUIRED: 'タイトルを入力してください',

    /** タイトル文字数超過 */
    TITLE_MAX_LENGTH: (max: number) => `タイトルは${max}文字以内で入力してください`,

    /** URL形式不正 */
    INVALID_URL,

    /** メールアドレス形式不正 */
    INVALID_EMAIL: '有効なメールアドレスを入力してください',

    /** 日付形式（YYYY-MM-DD）不正 */
    DATE_FORMAT_INVALID: '日付は YYYY-MM-DD 形式で指定してください',

    /** 無効な日付 */
    DATE_INVALID: '無効な日付です',

    /** 日付範囲未入力 */
    DATE_RANGE_REQUIRED: '開始日と終了日を入力してください',

    /** 日付範囲の順序不正 */
    DATE_RANGE_ORDER_INVALID: '開始日は終了日以前の日付を指定してください',

    /** サービス名必須 */
    SERVICE_NAME_REQUIRED: 'サービス名は必須です',

    /** サービス数不足 */
    SERVICE_MIN_COUNT: '最低1つのサービスが必要です',

    /** カスタマーID形式（10桁数字） */
    CUSTOMER_ID_FORMAT: 'カスタマー ID は 10桁の数字で指定してください',

    /** キャンペーンID形式（数値のみ） */
    CAMPAIGN_ID_FORMAT: 'キャンペーン ID は数値のみで指定してください',

    /** GA4プロパティID必須 */
    GA4_PROPERTY_ID_REQUIRED: 'GA4プロパティIDは必須です',

    /** イベント名必須 */
    GA4_EVENT_NAME_REQUIRED: 'イベント名は必須です',

    /** 変換イベント数上限（前段CVイベントのラベル付きで表示されるため簡潔に） */
    GA4_CONVERSION_EVENTS_MAX: (max: number) => `${max}件以内で選択してください`,
  },

  /**
   * ErrorBoundary・global-error 用のエラーメッセージ
   * ユーザー向け表示では raw error.message を出さず、ここで定義した日本語を使用する
   */
  ERROR_BOUNDARY: {
    /** チャンク読み込み失敗（コード分割の読み込みエラー） */
    CHUNK_LOAD: 'アプリケーションの読み込みに失敗しました。ページを再読み込みしてください。',

    /** ネットワークエラー */
    NETWORK: 'ネットワークエラーが発生しました。接続を確認してください。',

    /** 認識できないエラー時のフォールバック（英語メッセージを表示しない） */
    FALLBACK: '予期せぬエラーが発生しました',
  },

  /**
   * 汎用エラーメッセージ
   */
  COMMON: {
    /** 一般的なサーバーエラー */
    SERVER_ERROR: 'サーバーエラーが発生しました',

    /** 予期しないエラー */
    UNEXPECTED_ERROR: '予期しないエラーが発生しました',

    /** ネットワークエラー */
    NETWORK_ERROR: 'ネットワークエラーが発生しました。接続を確認してください。',

    /** 保存失敗 */
    SAVE_FAILED: '保存に失敗しました',

    /** 削除失敗 */
    DELETE_FAILED: '削除に失敗しました',

    /** 更新失敗 */
    UPDATE_FAILED: '更新に失敗しました',

    /** トークン更新成功時 */
    TOKEN_REFRESHED: 'トークンを更新しました',

    /** キャッシュクリア通知送信時 */
    CACHE_CLEAR_SENT: 'キャッシュクリアの通知を送信しました',

    /** トークン更新リクエスト失敗（WP等） */
    TOKEN_REFRESH_REQUEST_FAILED: 'トークンの更新リクエストに失敗しました',

    /** トークン更新失敗（アクセストークン未取得） */
    TOKEN_REFRESH_ACCESS_MISSING: 'トークンの更新に失敗しました（アクセストークンが取得できませんでした）',
  },

  /**
   * チャット関連のエラーメッセージ
   */
  CHAT: {
    /** セッションの削除に失敗した場合 */
    SESSION_DELETE_FAILED: 'チャットセッションの削除に失敗しました',

    /** チャットタイトルの更新に失敗した場合 */
    SESSION_TITLE_UPDATE_FAILED: 'チャットタイトルの更新に失敗しました',

    /** セッションIDが必要な場合 */
    SESSION_ID_REQUIRED: 'セッションIDが必要です',

    /** チャットセッションの検索に失敗した場合 */
    SESSION_SEARCH_FAILED: 'チャットセッションの検索に失敗しました',
  },

  /**
   * ユーザー関連のエラーメッセージ
   */
  USER: {
    /** ユーザーが見つからない場合 */
    USER_NOT_FOUND: 'ユーザーが見つかりません',

    /** ユーザー情報が見つからない場合 */
    USER_INFO_NOT_FOUND: 'ユーザー情報が見つかりません',

    /** ユーザー情報の取得に失敗した場合 */
    USER_INFO_FETCH_FAILED: 'ユーザー情報の取得に失敗しました',

    /** ユーザー情報の確認に失敗した場合 */
    USER_INFO_VERIFY_FAILED: 'ユーザー情報の確認に失敗しました',

    /** フルネームの更新に失敗した場合 */
    FULL_NAME_UPDATE_FAILED: 'フルネームの更新に失敗しました',

    /** フルネームの更新中にエラーが発生した場合 */
    FULL_NAME_UPDATE_ERROR: 'フルネームの更新中にエラーが発生しました',

    /** サービスの利用が停止されている場合 */
    SERVICE_UNAVAILABLE: 'サービスの利用が停止されています',

    /** 閲覧権限では利用できない場合 */
    VIEW_MODE_NOT_ALLOWED: '閲覧権限では利用できません',

    /** 閲覧モードでは操作できない場合 */
    VIEW_MODE_OPERATION_NOT_ALLOWED: '閲覧モードでは操作できません',

    /** 権限が不足している場合 */
    INSUFFICIENT_PERMISSIONS: '権限がありません',

    /** 管理者権限が必要な場合 */
    ADMIN_REQUIRED: '管理者権限が必要です',

    /** 権限の取得に失敗した場合 */
    PERMISSION_ACQUISITION_FAILED: '権限の取得に失敗しました',

    /** 権限チェックに失敗した場合 */
    PERMISSION_VERIFY_FAILED: '権限チェックに失敗しました',

    /** 権限確認中にエラーが発生した場合 */
    PERMISSION_CHECK_ERROR: '権限確認中にエラーが発生しました',

    /** 無効な権限が指定された場合 */
    INVALID_ROLE: '無効な権限が指定されました',

    /** ユーザー権限の更新中にエラーが発生した場合 */
    ROLE_UPDATE_ERROR: 'ユーザー権限の更新中にエラーが発生しました',

    /** ユーザー一覧の取得中にエラーが発生した場合 */
    USER_LIST_FETCH_ERROR: 'ユーザー一覧の取得中にエラーが発生しました',
  },

  /**
   * Google Search Console関連のエラーメッセージ
   */
  GSC: {
    /** Google Search Consoleが未接続の場合 */
    NOT_CONNECTED: 'Google Search Consoleが未接続です',

    /** Googleアカウントの認証が期限切れまたは取り消されている場合 */
    AUTH_EXPIRED_OR_REVOKED: 'Googleアカウントの認証が期限切れまたは取り消されています',

    /** プロパティ一覧の取得に失敗した場合 */
    PROPERTIES_FETCH_FAILED: 'プロパティ一覧の取得に失敗しました',

    /** propertyUriが必須の場合 */
    PROPERTY_URI_REQUIRED: 'propertyUriは必須です',

    /** プロパティの保存に失敗した場合 */
    PROPERTY_SAVE_FAILED: 'プロパティの保存に失敗しました',

    /** 連携解除に失敗した場合 */
    DISCONNECT_FAILED: '連携解除に失敗しました',

    /** ステータスの取得に失敗した場合 */
    STATUS_FETCH_FAILED: 'ステータスの取得に失敗しました',

    /** startDateとendDateが必須の場合 */
    DATE_RANGE_REQUIRED: 'startDate と endDate は必須です',

    /** maxRowsの範囲が不正な場合 */
    MAX_ROWS_INVALID: 'maxRows は 1～25000 の範囲で指定してください',

    /** 日付の形式が不正な場合 */
    INVALID_DATE_FORMAT: '日付の形式が不正です',

    /** 開始日が終了日より後になっている場合 */
    START_DATE_AFTER_END: '開始日は終了日より前である必要があります',

    /** 期間が最大値を超えている場合 */
    PERIOD_TOO_LONG: '期間は最大365日までです',

    /** インポート処理に失敗した場合 */
    IMPORT_FAILED: 'インポート処理に失敗しました',

    /** 対象が見つからない場合 */
    TARGET_NOT_FOUND: '対象が見つかりません',

    /** 詳細の取得に失敗した場合 */
    DETAIL_FETCH_FAILED: '詳細の取得に失敗しました',

    /** 必須パラメータが不足している場合 */
    REQUIRED_PARAMS_MISSING: 'contentAnnotationId, propertyUri, baseEvaluationDate は必須です',

    /** 日付形式が不正な場合（YYYY-MM-DD形式） */
    INVALID_DATE_FORMAT_YYYYMMDD: '日付は YYYY-MM-DD 形式で指定してください',

    /** 無効な日付が指定された場合 */
    INVALID_DATE: '無効な日付が指定されました',

    /** 評価サイクル日数の範囲が不正な場合 */
    CYCLE_DAYS_INVALID: '評価サイクル日数は1〜365日の範囲で指定してください',

    /** 評価実行時間の範囲が不正な場合 */
    EVALUATION_HOUR_INVALID: '評価実行時間は0〜23の範囲で指定してください',

    /** 指定された記事が見つからない場合 */
    ARTICLE_NOT_FOUND: '指定された記事が見つかりません',

    /** 記事が既に評価対象として登録されている場合 */
    ARTICLE_ALREADY_REGISTERED: 'この記事は既に評価対象として登録されています',

    /** 評価対象の登録に失敗した場合 */
    EVALUATION_REGISTER_FAILED: '評価対象の登録に失敗しました',

    /** 評価対象が見つからない場合 */
    EVALUATION_NOT_FOUND: '評価対象が見つかりません',

    /** 評価日の更新に失敗した場合 */
    EVALUATION_DATE_UPDATE_FAILED: '評価日の更新に失敗しました',

    /** GSC連携設定が見つからない場合 */
    CREDENTIAL_NOT_FOUND: 'GSC連携設定が見つかりません',

    /** 記事が見つからない場合 */
    ARTICLE_NOT_FOUND_GENERIC: '記事が見つかりません',

    /** クエリ分析の取得に失敗した場合 */
    QUERY_ANALYSIS_FETCH_FAILED: 'クエリ分析の取得に失敗しました',

    /** annotationIdが必須の場合 */
    ANNOTATION_ID_REQUIRED: 'annotationId は必須です',

    /** 記事情報の取得に失敗した場合 */
    ARTICLE_INFO_FETCH_FAILED: '記事情報の取得に失敗しました',

    /** 記事のURLが見つからない場合 */
    ARTICLE_URL_NOT_FOUND: '記事のURLが見つかりません',

    /** URLの正規化に失敗した場合 */
    URL_NORMALIZE_FAILED: 'URLの正規化に失敗しました',

    /** クエリ指標の取得に失敗した場合 */
    QUERY_METRICS_FETCH_FAILED: 'クエリ指標の取得に失敗しました',

    /** 設定中のGSCプロパティと記事URLが一致しない場合 */
    PROPERTY_URL_MISMATCH:
      '現在設定中のGSCプロパティがこの記事URLと一致していません。設定ダッシュボードで対象サイトのプロパティに切り替えてください。',

    /** 評価処理に失敗した場合 */
    EVALUATION_PROCESS_FAILED: '評価処理に失敗しました',
  },

  /**
   * GA4関連のエラーメッセージ
   */
  GA4: {
    /** GA4が未接続の場合 */
    NOT_CONNECTED: 'GA4が未接続です',

    /** ステータスの取得に失敗した場合 */
    STATUS_FETCH_FAILED: 'ステータスの取得に失敗しました',

    /** GA4の権限が不足している場合 */
    INSUFFICIENT_PERMISSION: 'GA4の権限が不足しています',

    /** Googleアカウントの認証が期限切れまたは取り消されている場合 */
    AUTH_EXPIRED_OR_REVOKED: 'Googleアカウントの認証が期限切れまたは取り消されています',

    /** GA4のスコープが不足している場合 */
    SCOPE_MISSING: 'GA4の権限スコープが不足しています。再認証してください。',

    /** GA4プロパティ一覧の取得に失敗した場合 */
    PROPERTIES_FETCH_FAILED: 'GA4プロパティ一覧の取得に失敗しました',

    /** GA4キーイベント一覧の取得に失敗した場合 */
    KEY_EVENTS_FETCH_FAILED: 'GA4キーイベント一覧の取得に失敗しました',

    /** GA4プロパティIDが必須の場合 */
    PROPERTY_ID_REQUIRED: 'GA4プロパティIDは必須です',

    /** GA4設定の保存に失敗した場合 */
    SETTINGS_SAVE_FAILED: 'GA4設定の保存に失敗しました',

    /** GA4同期に失敗した場合 */
    SYNC_FAILED: 'GA4同期に失敗しました',
  },

  /**
   * Google Ads関連のエラーメッセージ
   */
  GOOGLE_ADS: {
    /** Google認証に失敗した場合 */
    AUTH_FAILED: 'Google認証に失敗しました',

    /** 認証パラメータが不足している場合 */
    MISSING_PARAMS: '認証パラメータが不足しています',

    /** 不正なリクエストの場合 */
    INVALID_STATE: '不正なリクエストです。もう一度お試しください',

    /** セッションが無効（Cookie不一致）の場合 */
    STATE_COOKIE_MISMATCH: 'セッションが無効です（Cookie不一致）。もう一度お試しください',

    /** ユーザー情報が一致しない場合 */
    STATE_USER_MISMATCH: 'ユーザー情報が一致しません。再度ログインしてください',

    /** 認証セッションの有効期限が切れた場合 */
    STATE_EXPIRED: '認証セッションの有効期限が切れました。もう一度お試しください',

    /** 認証情報の形式が不正な場合 */
    INVALID_CREDENTIALS: '認証情報の形式が不正です。もう一度お試しください',

    /** サーバーエラー */
    SERVER_ERROR: 'サーバーエラーが発生しました。時間をおいて再度お試しください',

    /** アカウント一覧の取得に失敗した場合 */
    ACCOUNT_LIST_FETCH_FAILED: 'アカウント一覧の取得に失敗しました。再認証してください',

    /** アクセス可能なアカウントが存在しない場合 */
    NO_ACCESSIBLE_ACCOUNTS:
      'アクセス可能なGoogle Adsアカウントが見つかりませんでした。Google Adsアカウントへのアクセス権限を確認してください',

    /** Google Adsアカウントが関連付けられていない場合 */
    NOT_ADS_USER:
      '認証したGoogleアカウントがGoogle Adsアカウントと関連付けられていません。Google Adsアカウントを作成するか、既存のGoogle Adsアカウントにアクセス権限を追加してください。',

    /** リフレッシュトークンが取得できなかった場合 */
    MISSING_REFRESH_TOKEN:
      'リフレッシュトークンを取得できませんでした。Googleアカウントの「アカウントにアクセスできるアプリ」からアクセス権を削除し、再度連携してください',

    /** 連携解除に失敗した場合 */
    DISCONNECT_FAILED: 'Google Ads連携の解除に失敗しました',

    /** customerId が指定されていない場合 */
    CUSTOMER_ID_REQUIRED: 'アカウントを選択してください',

    /** 認証情報が見つからない場合 */
    CREDENTIAL_NOT_FOUND: 'Google Ads認証情報が見つかりません。再認証してください。',

    /** アクセストークンの更新に失敗した場合 */
    TOKEN_REFRESH_FAILED: 'アクセストークンの更新に失敗しました。再認証してください。',

    /** アカウント一覧の取得に失敗した場合（select route用） */
    ACCOUNT_LIST_FETCH_FAILED_SELECT: 'アカウント一覧の取得に失敗しました',

    /** 指定されたアカウントIDにアクセス権限がない場合 */
    ACCOUNT_ACCESS_DENIED: '指定されたアカウントIDにアクセス権限がありません',

    /** アカウント選択の保存に失敗した場合 */
    ACCOUNT_SELECT_FAILED: 'アカウント選択の保存に失敗しました',

    /** 不明なエラー */
    UNKNOWN_ERROR: '不明なエラーが発生しました',

    /** Google Ads が未接続の場合 */
    NOT_CONNECTED: 'Google Adsが未接続です',

    /** アカウントが選択されていない場合 */
    ACCOUNT_NOT_SELECTED:
      'アカウントが選択されていません。設定画面からアカウントを選択してください',

    /** Google Ads 認証が期限切れまたは取り消されている場合 */
    AUTH_EXPIRED_OR_REVOKED: 'Google Adsの認証が期限切れまたは取り消されています',

    /** キーワード指標の取得に失敗した場合 */
    KEYWORD_METRICS_FETCH_FAILED: 'キーワード指標の取得に失敗しました',

    /** Google Ads開発者トークンが設定されていない場合 */
    DEVELOPER_TOKEN_MISSING: 'Google Ads開発者トークンが設定されていません',

    /** 日付範囲が必須の場合 */
    DATE_RANGE_REQUIRED: 'startDate と endDate は必須です',

    /** 入力パラメータが不正な場合 */
    INVALID_INPUT: (errors: string): string => `入力パラメータが不正です: ${errors}`,

    /** Google Ads ダッシュボードのデータ取得に失敗した場合 */
    DASHBOARD_FETCH_FAILED: 'データ取得に失敗しました',

    /** Google Ads ダッシュボードのデータ取得ガイダンス（未連携） */
    DASHBOARD_GUIDANCE_NOT_CONNECTED: 'Google Ads が未連携です。連携設定を完了してください。',

    /** Google Ads ダッシュボードのデータ取得ガイダンス（未選択） */
    DASHBOARD_GUIDANCE_NOT_SELECTED:
      'MCC 配下のアカウントが選択されていません。設定画面で対象アカウントを選択してください。',

    /** Google Ads ダッシュボードのデータ取得ガイダンス（認証期限） */
    DASHBOARD_GUIDANCE_AUTH_EXPIRED: '認証が期限切れまたは取り消されています。再認証してください。',

    /** Google Ads ダッシュボードのデータ取得ガイダンス（汎用） */
    DASHBOARD_GUIDANCE_UNKNOWN: '取得に失敗しました。時間をおいて再試行してください。',

    /** Google Ads ダッシュボードのデータ取得ガイダンス（管理者権限が必要） */
    DASHBOARD_GUIDANCE_ADMIN_REQUIRED:
      'Google Ads 連携機能は現在、管理者ユーザーのみ利用可能です。管理者に問い合わせるか、権限設定を確認してください。',
  },

  /**
   * プロンプト関連のエラーメッセージ
   */
  PROMPT: {
    /** 同じ名前のプロンプトが既に存在する場合 */
    DUPLICATE_NAME: '同じ名前のプロンプトが既に存在します',

    /** プロンプトの作成に失敗した場合 */
    CREATE_FAILED: 'プロンプトの作成に失敗しました',

    /** プロンプトが見つからない場合 */
    NOT_FOUND: 'プロンプトが見つかりません',

    /** プロンプトの更新に失敗した場合 */
    UPDATE_FAILED: 'プロンプトの更新に失敗しました',

    /** プロンプトの取得に失敗した場合 */
    FETCH_FAILED: 'プロンプトの取得に失敗しました',

    /** プロンプトの検証に失敗した場合 */
    VALIDATION_FAILED: 'プロンプトの検証に失敗しました',

    /** 入力データが不正な場合 */
    INVALID_INPUT: (errors: string[]): string => `入力データが不正です: ${errors.join(', ')}`,
  },

  /**
   * 事業者情報（Brief）関連のエラーメッセージ
   */
  BRIEF: {
    /** 入力エラーが発生した場合 */
    INPUT_ERROR: (fieldErrors: string): string => `入力エラー: ${fieldErrors}`,

    /** 事業者情報の保存に失敗した場合 */
    SAVE_FAILED: '事業者情報の保存に失敗しました',

    /** 事業者情報の取得に失敗した場合 */
    FETCH_FAILED: '事業者情報の取得に失敗しました',

    /** ログインが必要な場合 */
    LOGIN_REQUIRED: 'ログインが必要です',

    /** データ形式が不正な場合 */
    INVALID_DATA_FORMAT: '事業者情報のデータ形式が不正です',
  },

  /**
   * 管理者関連のエラーメッセージ
   */
  ADMIN: {
    /** キャッシュクリアに失敗した場合 */
    CACHE_CLEAR_FAILED: 'キャッシュクリアに失敗しました',
  },
} as const;
