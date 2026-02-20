'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { GscService } from '@/server/services/gscService';
import { Ga4Service } from '@/server/services/ga4Service';
import { ga4SettingsSchema } from '@/server/schemas/ga4.schema';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { toGa4ConnectionStatus } from '@/server/lib/ga4-status';
import type { Ga4ConnectionStatus } from '@/types/ga4';
import type { GscCredential } from '@/types/gsc';
import { isGa4ReauthError } from '@/domain/errors/ga4-error-handlers';
import { GA4_SCOPE } from '@/lib/constants';
import { ensureValidAccessToken } from '@/server/services/googleTokenService';
import type { ServerActionResult } from '@/lib/async-handler';
import { canAccessGa4, canWriteGa4 } from '@/server/lib/ga4-permissions';

const supabaseService = new SupabaseService();
const gscService = new GscService();
const ga4Service = new Ga4Service();

const OWNER_ONLY_ERROR_MESSAGE = ERROR_MESSAGES.AUTH.STAFF_OPERATION_NOT_ALLOWED;
const GA4_SETTINGS_FIELD_LABELS: Record<string, string> = {
  propertyId: 'GA4プロパティID',
  propertyName: 'GA4プロパティ名',
  conversionEvents: '前段CVイベント',
  thresholdEngagementSec: '滞在時間の閾値',
  thresholdReadRate: '読了率の閾値',
};

const formatGa4SettingsValidationError = (error: z.ZodError): string => {
  const issue = error.issues[0];
  if (!issue) {
    return ERROR_MESSAGES.COMMON.UPDATE_FAILED;
  }
  const pathKey = String(issue.path[0] ?? '');
  const fieldLabel = GA4_SETTINGS_FIELD_LABELS[pathKey];
  if (!fieldLabel) {
    return issue.message || ERROR_MESSAGES.COMMON.UPDATE_FAILED;
  }
  return `${fieldLabel}: ${issue.message}`;
};

const ensureAccessToken = async (userId: string, refreshToken: string, credential: {
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  scope?: string[] | null;
}) =>
  ensureValidAccessToken({ ...credential, refreshToken }, {
    refreshAccessToken: (rt) => gscService.refreshAccessToken(rt),
    persistToken: (accessToken, expiresAt, scope) =>
      supabaseService.updateGscCredential(userId, {
        accessToken,
        accessTokenExpiresAt: expiresAt,
        scope: scope ?? credential.scope ?? null,
      }),
  });

interface AuthSuccess {
  userId: string;
  ownerUserId: string | null;
  role: import('@/types/user').UserRole | null;
  viewMode: boolean;
  error?: undefined;
}
interface AuthFailure {
  error: string;
  userId?: undefined;
  ownerUserId?: undefined;
  role?: undefined;
  viewMode?: undefined;
}
type AuthResult = AuthSuccess | AuthFailure;

const getAuthUserId = async (): Promise<AuthResult> => {
  const { accessToken, refreshToken } = await getLiffTokensFromCookies();
  const authResult = await authMiddleware(accessToken, refreshToken);
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  // View Modeの場合でも、Setup画面の操作は本来のユーザー（オーナー）として実行する
  const realUserId = authResult.actorUserId || authResult.userId;
  // actorUserIdがある = View Modeでオーナーとして操作中
  const isViewModeAsOwner = !!authResult.actorUserId;

  return {
    userId: realUserId,
    ownerUserId: isViewModeAsOwner ? null : (authResult.ownerUserId ?? null),
    role: authResult.userDetails?.role ?? null,
    viewMode: authResult.viewMode ?? false,
  };
};

interface Ga4ActionContext {
  userId: string;
  credential: GscCredential;
}

type Ga4ActionContextResult =
  | { success: true; data: Ga4ActionContext }
  | { success: false; error: string; needsReauth?: boolean };

const resolveGa4ActionContext = async (): Promise<Ga4ActionContextResult> => {
  const authResult = await getAuthUserId();
  if ('error' in authResult) {
    return { success: false, error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  const { userId, ownerUserId, role, viewMode } = authResult;
  if (!canAccessGa4({ role, ownerUserId, viewMode })) {
    return { success: false, error: OWNER_ONLY_ERROR_MESSAGE };
  }

  const credential = await supabaseService.getGscCredentialByUserId(userId);
  if (!credential) {
    return { success: false, error: ERROR_MESSAGES.GA4.NOT_CONNECTED };
  }

  const scope = credential.scope ?? [];
  if (!scope.includes(GA4_SCOPE)) {
    return { success: false, error: ERROR_MESSAGES.GA4.SCOPE_MISSING, needsReauth: true };
  }

  return { success: true, data: { userId, credential } };
};

export async function fetchGa4Status(): Promise<ServerActionResult<Ga4ConnectionStatus>> {
  try {
    const authResult = await getAuthUserId();
    if ('error' in authResult) {
      return { success: false, error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    const { userId, ownerUserId, role, viewMode } = authResult;
    if (!canAccessGa4({ role, ownerUserId, viewMode })) {
      return { success: false, error: OWNER_ONLY_ERROR_MESSAGE };
    }

    const credential = await supabaseService.getGscCredentialByUserId(userId);
    const status = toGa4ConnectionStatus(credential);
    return { success: true, data: status };
  } catch (error) {
    console.error('[GA4 Setup] fetch status failed', error);
    return { success: false, error: ERROR_MESSAGES.GA4.STATUS_FETCH_FAILED };
  }
}

export async function fetchGa4Properties() {
  try {
    const contextResult = await resolveGa4ActionContext();
    if (!contextResult.success) {
      if (contextResult.needsReauth) {
        return { success: false, error: contextResult.error, needsReauth: true };
      }
      return { success: false, error: contextResult.error };
    }

    const { userId, credential } = contextResult.data;
    const accessToken = await ensureAccessToken(userId, credential.refreshToken, credential);
    const properties = await ga4Service.listProperties(accessToken);

    return { success: true, data: properties };
  } catch (error) {
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GA4.PROPERTIES_FETCH_FAILED;
    console.error('[GA4 Setup] fetch properties failed', error);
    if (isGa4ReauthError(message)) {
      return {
        success: false,
        error: ERROR_MESSAGES.GA4.AUTH_EXPIRED_OR_REVOKED,
        needsReauth: true,
      };
    }
    return { success: false, error: ERROR_MESSAGES.GA4.PROPERTIES_FETCH_FAILED };
  }
}

export async function fetchGa4KeyEvents(propertyId: string) {
  try {
    if (!propertyId) {
      return { success: false, error: ERROR_MESSAGES.GA4.PROPERTY_ID_REQUIRED };
    }

    const contextResult = await resolveGa4ActionContext();
    if (!contextResult.success) {
      if (contextResult.needsReauth) {
        return { success: false, error: contextResult.error, needsReauth: true };
      }
      return { success: false, error: contextResult.error };
    }

    const { userId, credential } = contextResult.data;
    const accessToken = await ensureAccessToken(userId, credential.refreshToken, credential);
    const keyEvents = await ga4Service.listKeyEvents(accessToken, propertyId);

    return { success: true, data: keyEvents };
  } catch (error) {
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GA4.KEY_EVENTS_FETCH_FAILED;
    console.error('[GA4 Setup] fetch key events failed', error);
    if (isGa4ReauthError(message)) {
      return {
        success: false,
        error: ERROR_MESSAGES.GA4.AUTH_EXPIRED_OR_REVOKED,
        needsReauth: true,
      };
    }
    return { success: false, error: ERROR_MESSAGES.GA4.KEY_EVENTS_FETCH_FAILED };
  }
}

/**
 * GA4設定を保存する。DB更新のみでGA4 APIを呼ばないため、
 * resolveGa4ActionContext（GA4スコープ検証）は行わない。
 */
export async function saveGa4Settings(input: unknown) {
  try {
    const authResult = await getAuthUserId();
    if ('error' in authResult) {
      return { success: false, error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    const { userId, ownerUserId, role, viewMode } = authResult;
    if (!canWriteGa4({ role, ownerUserId, viewMode })) {
      return { success: false, error: OWNER_ONLY_ERROR_MESSAGE };
    }

    const parsed = ga4SettingsSchema.safeParse(input);
    if (!parsed.success) {
      console.error('[GA4 Setup] validation failed', z.prettifyError(parsed.error));
      return { success: false, error: formatGa4SettingsValidationError(parsed.error) };
    }

    const conversionEvents = Array.isArray(parsed.data.conversionEvents)
      ? Array.from(new Set(parsed.data.conversionEvents))
      : [];

    const credential = await supabaseService.getGscCredentialByUserId(userId);
    const propertyChanged = parsed.data.propertyId !== credential?.ga4PropertyId;

    await supabaseService.updateGscCredential(userId, {
      ga4PropertyId: parsed.data.propertyId,
      ga4PropertyName: parsed.data.propertyName ?? null,
      ga4ConversionEvents: conversionEvents,
      ga4ThresholdEngagementSec: parsed.data.thresholdEngagementSec ?? null,
      ga4ThresholdReadRate: parsed.data.thresholdReadRate ?? null,
      ...(propertyChanged && { ga4LastSyncedAt: null }),
    });

    const updatedCredential = await supabaseService.getGscCredentialByUserId(userId);
    revalidatePath('/setup');
    revalidatePath('/setup/ga4');

    return { success: true, data: toGa4ConnectionStatus(updatedCredential) };
  } catch (error) {
    console.error('[GA4 Setup] save settings failed', error);
    return { success: false, error: ERROR_MESSAGES.GA4.SETTINGS_SAVE_FAILED };
  }
}

export async function refetchGa4StatusWithValidation(): Promise<
  | { success: true; data: Ga4ConnectionStatus; needsReauth: boolean }
  | { success: false; error: string; needsReauth?: boolean }
> {
  try {
    const statusResult = await fetchGa4Status();
    if (!statusResult.success || !statusResult.data) {
      return {
        success: false,
        error: statusResult.error || ERROR_MESSAGES.GA4.PROPERTIES_FETCH_FAILED,
      };
    }

    const status = statusResult.data;

    if (status.connectionStage !== 'unlinked') {
      const propertiesResult = await fetchGa4Properties();
      if (
        !propertiesResult.success &&
        'needsReauth' in propertiesResult &&
        propertiesResult.needsReauth
      ) {
        return {
          success: true,
          data: status,
          needsReauth: true,
        };
      }
    }

    return {
      success: true,
      data: status,
      needsReauth: false,
    };
  } catch (error) {
    console.error('GA4ステータス取得エラー:', error);
    return { success: false, error: ERROR_MESSAGES.GA4.PROPERTIES_FETCH_FAILED };
  }
}
