import { NextResponse } from 'next/server';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  ensureGoogleAdsAuth,
  refreshGoogleAdsTokenIfNeeded,
} from '@/server/lib/google-auth';

interface CustomerInfo {
  name: string | null;
  isManager: boolean;
}

/**
 * アクセス可能なGoogle Adsアカウント一覧を取得
 */
export async function GET() {
  try {
    // 認証・権限チェックと認証情報取得
    const authResult = await ensureGoogleAdsAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { userId, credential } = authResult;

    // アクセストークンが期限切れの場合はリフレッシュ
    const tokenResult = await refreshGoogleAdsTokenIfNeeded(userId, credential);
    if (!tokenResult.success) {
      return tokenResult.response;
    }
    const accessToken = tokenResult.accessToken;

    // アカウント一覧を取得
    const googleAdsService = new GoogleAdsService();
    try {
      const customerIds = await googleAdsService.listAccessibleCustomers(accessToken);

      // 各アカウントの情報（表示名 + MCC判定）を取得
      // 1パス目: login-customer-id なしで各アカウントの情報を取得しMCCを特定
      const customerInfoMap = new Map<string, CustomerInfo>();

      // 各アカウントの情報を並列取得
      const infoResults = await Promise.all(
        customerIds.map(async id => {
          try {
            const info = await googleAdsService.getCustomerInfo(id, accessToken);
            return { id, info };
          } catch (infoError) {
            console.warn('Failed to resolve Google Ads customer info', {
              customerId: process.env.NODE_ENV === 'development' ? id : '(redacted)',
              error: infoError instanceof Error ? infoError.message : String(infoError),
            });
            return { id, info: null };
          }
        })
      );

      // 結果をMapに格納し、MCCを特定（競合状態を回避）
      for (const { id, info } of infoResults) {
        if (info) {
          customerInfoMap.set(id, info);
        }
      }
      const storedManagerId = authResult.credential.managerCustomerId || null;
      const storedManagerIsManager =
        !!storedManagerId &&
        infoResults.find(r => r.id === storedManagerId)?.info?.isManager === true;
      const detectedManagerId = infoResults.find(r => r.info?.isManager)?.id || null;
      const mccCustomerId: string | null =
        storedManagerIsManager ? storedManagerId : detectedManagerId;

      // 2パス目: MCC配下の子アカウントで名前が取得できなかった場合、login-customer-id を指定して再取得
      if (mccCustomerId) {
        await Promise.all(
          customerIds.map(async id => {
            const existing = customerInfoMap.get(id);
            // MCC自身でなく、情報未取得または名前が取得できていないアカウントを再試行
            if (id !== mccCustomerId && (!existing || !existing.name)) {
              try {
                const info = await googleAdsService.getCustomerInfo(id, accessToken, mccCustomerId);
                if (info) {
                  customerInfoMap.set(id, info);
                }
              } catch (retryError) {
                console.warn('Failed to resolve Google Ads customer info (with MCC)', {
                  customerId: process.env.NODE_ENV === 'development' ? id : '(redacted)',
                  mccCustomerId: process.env.NODE_ENV === 'development' ? mccCustomerId : '(redacted)',
                  error: retryError instanceof Error ? retryError.message : String(retryError),
                });
              }
            }
          })
        );
      }

      const accounts = customerIds.map(id => {
        const info = customerInfoMap.get(id);
        return {
          customerId: id,
          displayName: info?.name || id,
          isManager: info?.isManager ?? false,
        };
      });

      return NextResponse.json({
        accounts,
      });
    } catch (apiError) {
      // NOT_ADS_USERエラーの場合は専用のエラーメッセージを返す
      const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
      if (errorMessage.includes('Google Adsアカウントと関連付けられていません')) {
        return NextResponse.json(
          { error: ERROR_MESSAGES.GOOGLE_ADS.NOT_ADS_USER },
          { status: 400 }
        );
      }
      // その他のエラーは再スローして下のcatchブロックで処理
      throw apiError;
    }
  } catch (error) {
    console.error('Error fetching Google Ads accounts:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // NOT_ADS_USERエラーの場合は専用のエラーメッセージを返す
    if (errorMessage.includes('Google Adsアカウントと関連付けられていません')) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.NOT_ADS_USER },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_LIST_FETCH_FAILED_SELECT },
      { status: 500 }
    );
  }
}
