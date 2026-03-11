/**
 * Feature Flags
 * NEXT_PUBLIC_ プレフィックスのため、クライアント・サーバー双方で参照可能。
 * デフォルトは有効（値が 'false' の場合のみ無効）。
 */
export const featureFlags = {
  /**
   * Email OTP ログイン機能の新規受付 on/off
   * OFF 時: 新規 Email 導線を非表示・OTP 送信/検証を停止する
   * 既存 Email セッションは有効のまま維持する（kill switch は別途運用対応）
   */
  emailAuthEnabled: process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED !== 'false',
} as const;
