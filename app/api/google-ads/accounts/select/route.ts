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
        customerId = value.replace(/\D/g, '');
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

    // 直接アクセス可能かどうかを記録（MCC配下クライアントは直接リストに載らないため、後でマネージャー経由も検証する）
    const isDirectlyAccessible = accessibleCustomerIds.includes(customerId);

    // MCC（マネージャー）アカウントIDを特定
    // 1パス目: login-customer-id なしで各アカウントの情報を取得しMCCを特定
    const infoResults = await Promise.all(
      accessibleCustomerIds.map(async id => {
        try {
          const info = await googleAdsService.getCustomerInfo(id, accessToken);
          return { id, isManager: info?.isManager ?? false, resolved: info !== null };
        } catch {
          return { id, isManager: false, resolved: false };
        }
      })
    );

    // 1パス目でMCCが特定できた場合、2パス目で未解決アカウントを再試行
    const detectedManagerId = infoResults.find(r => r.isManager)?.id ?? null;
    if (detectedManagerId) {
      await Promise.all(
        infoResults.map(async r => {
          if (!r.resolved && r.id !== detectedManagerId) {
            try {
              const info = await googleAdsService.getCustomerInfo(r.id, accessToken, detectedManagerId);
              if (info) {
                r.isManager = info.isManager;
                r.resolved = true;
              }
            } catch {
              // フォールバック: 非マネージャーとして扱う
            }
          }
        })
      );
    }

    const managerCandidates = infoResults.map(r => ({ id: r.id, isManager: r.isManager }));

    const managerCandidateIds = managerCandidates
      .filter(candidate => candidate.isManager)
      .map(candidate => candidate.id);

    // 各マネージャー候補に対して、選択アカウントが配下に存在するかを確認
    // 自己参照を避けるため、customerId自身をマネージャー候補から除外
    const managerIdsToCheck = managerCandidateIds.filter(id => id !== customerId);
    const managerLevels = await Promise.all(
      managerIdsToCheck.map(async managerId => {
        const clientInfo = await googleAdsService.getCustomerClientInfoUnderManager(
          managerId,
          customerId,
          accessToken
        );
        return { managerId, clientInfo };
      })
    );

    const validManagers = managerLevels.filter(
      manager => manager.clientInfo !== null
    ) as Array<{ managerId: string; clientInfo: { level: number; isManager: boolean } }>;

    // 最も近い（level が最小）マネージャーを採用
    const sortedManagers = [...validManagers].sort(
      (a, b) => a.clientInfo.level - b.clientInfo.level
    );
    const isSelectedManager = managerCandidates.some(
      candidate => candidate.id === customerId && candidate.isManager
    );
    const isSelectedManagerUnderManager = validManagers.some(
      manager => manager.clientInfo.isManager
    );

    // MCC（マネージャー）アカウント自体を単体で保存することは許可しない
    if (isSelectedManager || isSelectedManagerUnderManager) {
      return NextResponse.json(
        {
          error:
            'マネージャーアカウントを直接選択することはできません。配下のクライアントアカウントを選択してください。',
        },
        { status: 400 }
      );
    }

    // アクセス権検証: 直接アクセス可能 OR MCC経由でアクセス可能、のいずれかが必要
    // （MCC配下のクライアントアカウントは listAccessibleCustomers に現れないため、マネージャー経由を許可する）
    if (!isDirectlyAccessible && validManagers.length === 0) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_ACCESS_DENIED },
        { status: 403 }
      );
    }

    const managerCustomerId = sortedManagers[0]?.managerId ?? null;

    const supabaseService = new SupabaseService();
    const updateResult = await supabaseService.updateGoogleAdsCustomerId(
      userId,
      customerId,
      managerCustomerId
    );
    if (!updateResult.success) {
      return NextResponse.json({ error: updateResult.error.userMessage }, { status: 500 });
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
