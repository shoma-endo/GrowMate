import { type NextRequest, NextResponse } from 'next/server';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { SupabaseService } from '@/server/services/supabaseService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { ensureGoogleAdsAuth, refreshGoogleAdsTokenIfNeeded } from '@/server/lib/google-auth';

/**
 * 選択されたGoogle AdsアカウントIDを保存
 */
export async function POST(request: NextRequest) {
  try {
    // 認証・権限チェックと認証情報取得
    const authResult = await ensureGoogleAdsAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { userId, credential } = authResult;

    // リクエストボディから customerId を取得
    let customerId: string | null = null;
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const value = body.customerId;
      if (typeof value === 'string') {
        customerId = value;
      }
    } catch {
      // JSONパース失敗時も400エラーを返す（不正なリクエストボディ）
    }

    if (!customerId) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.CUSTOMER_ID_REQUIRED },
        { status: 400 }
      );
    }

    // アクセストークンが期限切れの場合はリフレッシュ
    const tokenResult = await refreshGoogleAdsTokenIfNeeded(userId, credential);
    if (!tokenResult.success) {
      return tokenResult.response;
    }
    const accessToken = tokenResult.accessToken;

    // アクセス可能なアカウント一覧を取得
    const googleAdsService = new GoogleAdsService();
    let accessibleCustomerIds: string[];
    try {
      accessibleCustomerIds = await googleAdsService.listAccessibleCustomers(accessToken);
    } catch (err) {
      console.error('Failed to fetch accessible customers:', err);
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_LIST_FETCH_FAILED_SELECT },
        { status: 500 }
      );
    }

    // リクエストされたcustomerIdがアクセス可能なアカウント一覧に含まれるか検証
    if (!accessibleCustomerIds.includes(customerId)) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_ACCESS_DENIED },
        { status: 403 }
      );
    }

    // MCC（マネージャー）アカウントIDを特定
    // customer.manager フィールドでマネージャー候補を抽出
    const managerCandidates = await Promise.all(
      accessibleCustomerIds.map(async id => {
        try {
          const info = await googleAdsService.getCustomerInfo(id, accessToken);
          return { id, isManager: info?.isManager ?? false };
        } catch {
          console.warn(`Failed to get customer info for ${id}, treating as non-manager`);
          return { id, isManager: false };
        }
      })
    );

    const managerCandidateIds = managerCandidates
      .filter(candidate => candidate.isManager)
      .map(candidate => candidate.id);

    // 各マネージャー候補に対して、選択アカウントが配下に存在するかを確認
    // 自己参照を避けるため、customerId自身をマネージャー候補から除外
    const managerIdsToCheck = managerCandidateIds.filter(id => id !== customerId);
    const managerLevels = await Promise.all(
      managerIdsToCheck.map(async managerId => {
        const level = await googleAdsService.getClientLevelUnderManager(
          managerId,
          customerId,
          accessToken
        );
        return { managerId, level };
      })
    );

    const validManagers = managerLevels.filter(
      manager => typeof manager.level === 'number'
    ) as Array<{ managerId: string; level: number }>;

    // 最も近い（level が最小）マネージャーを採用
    const sortedManagers = [...validManagers].sort((a, b) => a.level - b.level);
    const isSelectedManager = managerCandidates.some(
      candidate => candidate.id === customerId && candidate.isManager
    );

    // MCC（マネージャー）アカウント自体を単体で保存することは許可しない
    if (isSelectedManager) {
      return NextResponse.json(
        {
          error:
            'マネージャーアカウントを直接選択することはできません。配下のクライアントアカウントを選択してください。',
        },
        { status: 400 }
      );
    }

    const managerCustomerId = sortedManagers[0]?.managerId ?? null;

    // customer_id と manager_customer_id を更新
    const supabaseService = new SupabaseService();
    const updateResult = await supabaseService.updateGoogleAdsCustomerId(
      userId,
      customerId,
      managerCustomerId
    );
    if (!updateResult.success) {
      return NextResponse.json({ error: updateResult.error.userMessage }, { status: 500 });
    }

    let customerInfo: Awaited<ReturnType<typeof googleAdsService.getCustomerInfo>> | null = null;
    try {
      customerInfo = await googleAdsService.getCustomerInfo(
        customerId,
        accessToken,
        managerCustomerId ?? undefined
      );
    } catch (error) {
      console.error('Failed to fetch customerInfo for customerId:', {
        customerId,
        managerCustomerId,
        error,
      });
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_SELECT_FAILED },
        { status: 500 }
      );
    }

    const syncResult = await supabaseService.upsertGoogleAdsEvaluationSettings({
      userId,
      customerId,
      customerName: customerInfo?.name ?? null,
    });
    if (!syncResult.success) {
      return NextResponse.json({ error: syncResult.error.userMessage }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      customerId,
    });
  } catch (error) {
    console.error('Error selecting Google Ads account:', error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_SELECT_FAILED },
      { status: 500 }
    );
  }
}
