/**
 * LINE OAuth コールバック失敗時: /login へリダイレクトし、クエリで理由コードのみ渡す（本文は載せない）
 */
export const LINE_OAUTH_CALLBACK_QUERY_PARAM = 'line_oauth_error' as const;

export const LINE_OAUTH_CALLBACK_MESSAGES = {
  invalid_state: 'セッションが無効です。ログイン画面から再度お試しください。',
  session_invalid: 'OAuthの開始から時間が経過した可能性があります。再度ログインしてください。',
  code_missing: '認証コードが取得できませんでした。もう一度ログインしてください。',
  token_exchange_failed: 'LINEとの連携に失敗しました。しばらく経ってから再度お試しください。',
  user_setup_failed: 'ログイン処理に失敗しました。しばらく経ってから再度お試しください。',
  session_handoff_failed: 'ログイン切り替えに失敗しました。ページを再読み込みしてから再度お試しください。',
  unexpected: 'サーバーエラーが発生しました。時間をおいて再度お試しください。',
} as const;

export type LineOauthCallbackErrorCode = keyof typeof LINE_OAUTH_CALLBACK_MESSAGES;
