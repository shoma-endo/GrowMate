import 'server-only';
import { SupabaseService } from '@/server/services/supabaseService';
import { GscService } from '@/server/services/gscService';
import { ensureValidAccessToken } from '@/server/services/googleTokenService';
import { isGoogleOAuthReauthError } from '@/domain/errors/google-oauth-error-handlers';
import type { GscCredential } from '@/types/gsc';

const supabaseService = new SupabaseService();
const gscService = new GscService();

export type HomeGoogleCredentialResult =
  | { kind: 'unconnected' }
  | { kind: 'ok'; credential: GscCredential }
  | { kind: 'transient_failure' };

/**
 * マイホームで GSC/GA4 の連携状態を計算する前に、実際にトークンをリフレッシュしておく。
 * GSC/GA4 は同一 credential 行（アクセストークン）を共有するため、ここで一度だけ試みれば
 * 両方のステータス計算（toGscConnectionStatus/toGa4ConnectionStatus）に使い回せる。
 * キャッシュが有効な間は ensureValidAccessToken 内部で実際の API 呼び出しをスキップする。
 */
export async function resolveHomeGoogleCredential(userId: string): Promise<HomeGoogleCredentialResult> {
  const credential = await supabaseService.getGscCredentialByUserId(userId);
  if (!credential) {
    return { kind: 'unconnected' };
  }

  let wasRefreshed = false;
  let refreshedExpiresAt: string | null = null;
  let refreshedScope: string[] | null = credential.scope ?? null;

  try {
    const accessToken = await ensureValidAccessToken(credential, {
      refreshAccessToken: rt => gscService.refreshAccessToken(rt),
      persistToken: async (token, expiresAt, scope) => {
        wasRefreshed = true;
        refreshedExpiresAt = expiresAt;
        // Google はスコープ不変時に応答へ scope を含めないことがあるため、既存値を保持する
        refreshedScope = scope ?? credential.scope ?? null;
        await supabaseService.updateGscCredential(userId, {
          accessToken: token,
          accessTokenExpiresAt: expiresAt,
          scope: refreshedScope,
        });
      },
    });

    const freshCredential: GscCredential = wasRefreshed
      ? { ...credential, accessToken, accessTokenExpiresAt: refreshedExpiresAt, scope: refreshedScope }
      : credential;
    return { kind: 'ok', credential: freshCredential };
  } catch (error) {
    console.error('[Home] GSC/GA4 credential refresh failed', error);
    if (isGoogleOAuthReauthError(error)) {
      // 本当の認証失効はそのまま古い credential を返す。
      // toGscConnectionStatus/toGa4ConnectionStatus 側の hasReusableAccessToken が
      // 古い期限切れ日時を見て自然に needsReauth:true と判定する。
      return { kind: 'ok', credential };
    }
    // DB保存失敗（updateGscCredential が例外を投げるケース）もここに落ちる。
    // メッセージが reauth 系のいずれにも一致しないため自然に transient 扱いになる。
    return { kind: 'transient_failure' };
  }
}
