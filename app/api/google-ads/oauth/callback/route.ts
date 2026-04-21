import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { verifyOAuthState } from '@/server/lib/oauth-state';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { SupabaseService } from '@/server/services/supabaseService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const cookieStore = await cookies();
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI;
  const cookieSecret = process.env.COOKIE_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const stateCookieName = 'gads_oauth_state';

  if (!redirectUri || !cookieSecret || !baseUrl) {
    console.error('Google Ads OAuth callbackの必須環境変数が不足しています');
    return NextResponse.json({ error: 'OAuth構成が未設定です' }, { status: 500 });
  }

  if (error) {
    console.error('❌ Google Ads OAuth Error:', error);
    return NextResponse.redirect(new URL('/setup/google-ads?error=auth_failed', baseUrl));
  }

  if (!code || !state) {
    console.error('❌ code または state がありません');
    return NextResponse.redirect(new URL('/setup/google-ads?error=missing_params', baseUrl));
  }

  try {
    // State検証
    const storedState = cookieStore.get(stateCookieName)?.value;

    // 1. CSRF対策: クッキーに保存されたStateと一致するか
    if (!storedState || storedState !== state) {
      console.error('OAuth state mismatch', { stored: !!storedState, received: !!state });
      const response = NextResponse.redirect(
        new URL('/setup/google-ads?error=state_cookie_mismatch', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // 2. Stateの内容検証 (署名, 有効期限)
    const verification = verifyOAuthState(state, cookieSecret);
    if (!verification.valid) {
      console.error('Invalid OAuth state:', verification.reason);
      const response = NextResponse.redirect(
        new URL(`/setup/google-ads?error=${encodeURIComponent(verification.reason)}`, baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // 3. ユーザーID確定
    // state に署名済み userId が含まれる。セッションが有効な場合は整合性チェックと viewMode チェックも行う。
    // セッション切れでも CSRF Cookie 一致 + HMAC 検証済みの state.userId があれば続行できる。
    let targetUserId: string | null = verification.payload.userId;

    const authResult = await authMiddleware();
    if (authResult.emailLinkConflict) {
      const response = NextResponse.redirect(
        new URL(
          `/setup/google-ads?error=${encodeURIComponent(ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT)}`,
          baseUrl
        )
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    if (!authResult.error && authResult.userId) {
      // セッション有効: 整合性チェックを実施
      if (targetUserId && targetUserId !== authResult.userId) {
        console.error('OAuth state user mismatch', {
          stateUser: targetUserId,
          currentUser: authResult.userId,
        });
        const response = NextResponse.redirect(
          new URL('/setup/google-ads?error=state_user_mismatch', baseUrl)
        );
        response.cookies.delete(stateCookieName);
        return response;
      }
      targetUserId = authResult.userId;
    } else if (!targetUserId) {
      // セッション切れかつ state に userId なし → 認証不可
      const response = NextResponse.redirect(
        new URL('/setup/google-ads?error=auth_required', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }
    // セッション切れだが state.userId あり → CSRF + HMAC 検証済みのため続行

    const supabaseService = new SupabaseService();

    // トークン交換
    const googleAdsService = new GoogleAdsService();
    const tokens = await googleAdsService.exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refreshToken) {
      console.error('Missing refresh token from Google Ads OAuth response');
      const response = NextResponse.redirect(
        new URL('/setup/google-ads?error=missing_refresh_token', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // Googleアカウント情報を取得
    let googleAccountEmail: string | null = null;
    try {
      const userInfo = await googleAdsService.fetchUserInfo(tokens.accessToken);
      googleAccountEmail = userInfo.email ?? null;
    } catch (err) {
      console.warn('Failed to fetch Google user info:', err);
    }

    // 再認証時に既存の customer_id と manager_customer_id を保持するため、既存の credential を取得
    const existingCredential = await supabaseService.getGoogleAdsCredential(targetUserId);

    // DB保存（トークン更新時も既存のアカウント選択情報を保持）
    const saveResult = await supabaseService.saveGoogleAdsCredential(targetUserId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope || [],
      googleAccountEmail,
      managerCustomerId: existingCredential?.managerCustomerId,
    });
    if (!saveResult.success) {
      console.error('Failed to save Google Ads credential:', {
        userMessage: saveResult.error.userMessage,
        developerMessage: saveResult.error.developerMessage,
        context: saveResult.error.context,
      });
      const response = NextResponse.redirect(
        new URL('/setup/google-ads?error=server_error', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // アクセス可能なアカウント一覧を取得
    let customerIds: string[] = [];
    try {
      customerIds = await googleAdsService.listAccessibleCustomers(tokens.accessToken);
    } catch (err) {
      console.error('Failed to fetch accessible customers:', err);
      // アカウント一覧取得に失敗した場合も、トークンは保存済みなので設定画面にリダイレクト
      const response = NextResponse.redirect(
        new URL('/setup/google-ads?error=account_list_fetch_failed', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // アクセス可能なアカウントがない場合
    if (customerIds.length === 0) {
      const response = NextResponse.redirect(
        new URL('/setup/google-ads?error=no_accessible_accounts', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // 既にアカウント選択済みで、かつそのアカウントが現在もアクセス可能な場合（再認証時）
    if (existingCredential?.customerId && customerIds.includes(existingCredential.customerId)) {
      let existingCustomerInfo: Awaited<
        ReturnType<typeof googleAdsService.getCustomerInfo>
      > | null = null;
      try {
        existingCustomerInfo = await googleAdsService.getCustomerInfo(
          existingCredential.customerId,
          tokens.accessToken,
          existingCredential.managerCustomerId ?? undefined
        );
      } catch (error) {
        console.warn('Failed to fetch customer info for existing Google Ads credential:', {
          userId: targetUserId,
          customerId: existingCredential.customerId,
          error,
        });
      }

      const syncResult = await supabaseService.upsertGoogleAdsEvaluationSettings({
        userId: targetUserId,
        customerId: existingCredential.customerId,
        customerName: existingCustomerInfo?.name ?? null,
      });
      if (!syncResult.success) {
        console.error('Failed to sync Google Ads evaluation settings:', syncResult.error);
      }

      const response = NextResponse.redirect(
        new URL('/setup/google-ads?success=true', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // アカウントが1つしかない場合は自動的に選択
    if (customerIds.length === 1) {
      const customerId = customerIds[0];
      if (!customerId) {
        // この分岐は理論上到達しないが、TypeScriptの型チェックのために必要
        const response = NextResponse.redirect(
          new URL('/setup/google-ads?error=server_error', baseUrl)
        );
        response.cookies.delete(stateCookieName);
        return response;
      }

      // customer.manager フィールドで MCC かどうかを判定
      let managerCustomerId: string | undefined;
      let customerName: string | null = null;
      try {
        const customerInfo = await googleAdsService.getCustomerInfo(
          customerId,
          tokens.accessToken
        );
        customerName = customerInfo?.name ?? null;
        if (customerInfo?.isManager) {
          managerCustomerId = customerId;
        }
      } catch (infoErr) {
        console.warn('Failed to check if account is manager:', infoErr);
      }

      const updateResult = await supabaseService.updateGoogleAdsCustomerId(
        targetUserId,
        customerId,
        managerCustomerId ?? null
      );
      if (!updateResult.success) {
        console.error('Failed to update customer ID:', {
          userMessage: updateResult.error.userMessage,
          developerMessage: updateResult.error.developerMessage,
          context: updateResult.error.context,
        });
        // トークンは保存済みなので、アカウント選択画面へフォールバック
        const response = NextResponse.redirect(
          new URL('/setup/google-ads?select_account=true', baseUrl)
        );
        response.cookies.delete(stateCookieName);
        return response;
      }

      const syncResult = await supabaseService.upsertGoogleAdsEvaluationSettings({
        userId: targetUserId,
        customerId,
        customerName,
      });
      if (!syncResult.success) {
        console.error('Failed to sync Google Ads evaluation settings:', syncResult.error);
      }

      const response = NextResponse.redirect(
        new URL('/setup/google-ads?success=true', baseUrl)
      );
      response.cookies.delete(stateCookieName);
      return response;
    }

    // 複数アカウントがある場合は選択画面にリダイレクト
    const response = NextResponse.redirect(
      new URL('/setup/google-ads?select_account=true', baseUrl)
    );
    response.cookies.delete(stateCookieName);
    return response;
  } catch (err) {
    console.error('Google Ads Callback Error:', err);
    const response = NextResponse.redirect(
      new URL('/setup/google-ads?error=server_error', baseUrl)
    );
    response.cookies.delete(stateCookieName);
    return response;
  }
}
