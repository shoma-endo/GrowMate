import type { Ga4ConnectionStatus } from '@/types/ga4';
import type { GscCredential } from '@/types/gsc';
import { GA4_SCOPE } from '@/lib/constants';
import { hasReusableAccessToken } from '@/server/services/googleTokenService';

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
