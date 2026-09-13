import type { Ga4ConnectionStatus, Ga4ConnectionStage } from '@/types/ga4';
import type { GscCredential } from '@/types/gsc';
import { GA4_SCOPE } from '@/lib/constants';
import { hasReusableAccessToken } from '@/server/services/googleTokenService';
import type { HomeGoogleCredentialResult } from '@/server/lib/home-google-credential';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

export function toGa4ConnectionStatus(credential: GscCredential | null): Ga4ConnectionStatus {
  if (!credential) {
    return { connected: false, connectionStage: 'unlinked' };
  }

  const hasValidToken = hasReusableAccessToken(credential);

  const scope = credential.scope ?? [];
  const scopeMissing = !scope.includes(GA4_SCOPE);
  const hasGa4Property = Boolean(credential.ga4PropertyId);
  const hasAvailableGa4Access = hasValidToken && !scopeMissing;
  const connectionStage = hasGa4Property
    ? 'configured'
    : hasAvailableGa4Access
      ? 'linked_unselected'
      : 'unlinked';

  return {
    connected: hasGa4Property || hasAvailableGa4Access,
    connectionStage,
    needsReauth: !hasValidToken || scopeMissing,
    scopeMissing,
    googleAccountEmail: credential.googleAccountEmail ?? null,
    propertyId: credential.ga4PropertyId ?? null,
    propertyName: credential.ga4PropertyName ?? null,
    conversionEvents: credential.ga4ConversionEvents ?? null,
    thresholdEngagementSec: credential.ga4ThresholdEngagementSec ?? null,
    thresholdReadRate: credential.ga4ThresholdReadRate ?? null,
    lastSyncedAt: credential.ga4LastSyncedAt ?? null,
    updatedAt: credential.updatedAt ?? null,
  };
}

/**
 * resolveHomeGoogleCredential の結果からGA4連携ステータスを組み立てる。
 * setup系ページ・Server Action（/setup, /setup/ga4, fetchGa4Status）はここを唯一の入口にする。
 * transient_failure時にneedsReauthを立てず hasTemporaryError で区別する理由は
 * gsc-status.ts の toGscConnectionStatusFromResolution と同じ。
 */
export function toGa4ConnectionStatusFromResolution(
  result: HomeGoogleCredentialResult
): Ga4ConnectionStatus {
  if (result.kind === 'unconnected') {
    return toGa4ConnectionStatus(null);
  }
  const status = toGa4ConnectionStatus(result.credential);
  if (result.kind === 'transient_failure') {
    // toGa4ConnectionStatus の connected/connectionStage/needsReauth は
    // hasValidToken（アクセストークンの期限切れ判定）に連動しているが、
    // transient_failure時はそのhasValidTokenの判定自体が信用できない
    // （リフレッシュを試みて確認できなかっただけ）。
    // scopeMissing はcredential.scopeという静的な事実から決まり
    // トークンの有効性とは独立なので、これはそのまま信用してよい
    // （GA4スコープ不足は一時的失敗でもみ消してはいけない、本当の再認証要）。
    // hasValidToken起因の部分だけ「不明＝あるものとみなす」に倒し、
    // 誤ってunlinked/needsReauthに転落させない。
    const scopeMissing = status.scopeMissing ?? false;
    const hasGa4Property = Boolean(result.credential.ga4PropertyId);
    const connectionStage: Ga4ConnectionStage = hasGa4Property
      ? 'configured'
      : scopeMissing
        ? 'unlinked'
        : 'linked_unselected';
    return {
      ...status,
      connected: hasGa4Property || !scopeMissing,
      connectionStage,
      needsReauth: scopeMissing,
      hasTemporaryError: true,
      temporaryErrorMessage: ERROR_MESSAGES.GA4.TOKEN_REFRESH_TEMPORARY_FAILURE,
    };
  }
  return status;
}
