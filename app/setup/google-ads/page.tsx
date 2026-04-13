import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getGoogleAdsConnectionStatus } from '@/server/actions/googleAds.actions';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { GoogleAdsAccountSelector } from '@/components/GoogleAdsAccountSelector';
import { GoogleAdsSetupClient } from '@/components/GoogleAdsSetupClient';

// エラーコードとメッセージのマッピング
const ERROR_MAP: Record<string, string> = {
  auth_failed: ERROR_MESSAGES.GOOGLE_ADS.AUTH_FAILED,
  missing_params: ERROR_MESSAGES.GOOGLE_ADS.MISSING_PARAMS,
  auth_required: ERROR_MESSAGES.AUTH.UNAUTHENTICATED,
  invalid_state: ERROR_MESSAGES.GOOGLE_ADS.INVALID_STATE,
  state_cookie_mismatch: ERROR_MESSAGES.GOOGLE_ADS.STATE_COOKIE_MISMATCH,
  state_user_mismatch: ERROR_MESSAGES.GOOGLE_ADS.STATE_USER_MISMATCH,
  state_expired: ERROR_MESSAGES.GOOGLE_ADS.STATE_EXPIRED,
  invalid_state_signature: ERROR_MESSAGES.GOOGLE_ADS.INVALID_CREDENTIALS,
  invalid_state_format: ERROR_MESSAGES.GOOGLE_ADS.INVALID_CREDENTIALS,
  invalid_state_payload: ERROR_MESSAGES.GOOGLE_ADS.INVALID_CREDENTIALS,
  missing_refresh_token: ERROR_MESSAGES.GOOGLE_ADS.MISSING_REFRESH_TOKEN,
  account_list_fetch_failed: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_LIST_FETCH_FAILED,
  no_accessible_accounts: ERROR_MESSAGES.GOOGLE_ADS.NO_ACCESSIBLE_ACCOUNTS,
  server_error: ERROR_MESSAGES.GOOGLE_ADS.SERVER_ERROR,
};

// サーバーコンポーネント
async function GoogleAdsSetupContent({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const success = searchParams.success === 'true';
  const disconnected = searchParams.disconnected === '1';
  const error = typeof searchParams.error === 'string' ? searchParams.error : undefined;

  // エラーメッセージの解決
  const errorMessage = error
    ? ERROR_MAP[error] || ERROR_MESSAGES.GOOGLE_ADS.UNKNOWN_ERROR
    : null;

  // DB から連携状態を取得
  const connectionStatus = await getGoogleAdsConnectionStatus();
  const isConnected = connectionStatus.connected;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/setup"
          className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          設定に戻る
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Google Ads 連携設定</h1>
        <p className="text-gray-600">
          Google Ads アカウントと連携し、広告パフォーマンスデータを取得します。
        </p>
      </div>

      {disconnected && !isConnected && (
        <Alert className="bg-green-50 border-green-200">
          <AlertTitle className="text-green-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span>連携を解除しました</span>
          </AlertTitle>
          <AlertDescription className="text-green-700">
            Google Ads 連携を解除しました。再度連携する場合は「Googleでログイン」から手続きしてください。
          </AlertDescription>
        </Alert>
      )}

      {success && isConnected && (
        <Alert className="bg-green-50 border-green-200">
          <AlertTitle className="text-green-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span>連携完了</span>
          </AlertTitle>
          <AlertDescription className="text-green-700">
            Google Ads アカウントとの連携が完了しました。
            {connectionStatus.googleAccountEmail && (
              <span className="block mt-1">
                連携アカウント: {connectionStatus.googleAccountEmail}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {!success && isConnected && connectionStatus.needsReauth && (
        <Alert className="bg-orange-50 border-orange-200">
          <AlertTitle className="text-orange-800 font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            <span>要再認証</span>
          </AlertTitle>
          <AlertDescription className="text-orange-700">
            認証トークンが期限切れまたは取り消されています。再認証してください。
            {connectionStatus.googleAccountEmail && (
              <span className="block mt-1">
                連携アカウント: {connectionStatus.googleAccountEmail}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {!success && isConnected && !connectionStatus.needsReauth && (
        <Alert className="bg-blue-50 border-blue-200">
          <AlertTitle className="text-blue-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-blue-600" />
            <span>連携済み</span>
          </AlertTitle>
          <AlertDescription className="text-blue-700">
            Google Ads アカウントと連携済みです。
            {connectionStatus.googleAccountEmail && (
              <span className="block mt-1">
                連携アカウント: {connectionStatus.googleAccountEmail}
              </span>
            )}
            <span className="block mt-1">
              アカウント種別:{' '}
              {connectionStatus.managerCustomerId ? 'MCC（マネージャー）' : '通常'}
            </span>
            {connectionStatus.customerId && (
              <span className="block mt-1">選択アカウントID: {connectionStatus.customerId}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <span>連携エラー</span>
          </AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Google Ads アカウント連携</CardTitle>
          <CardDescription>
            「Googleでログイン」ボタンを押すとGoogleの認証画面に移動します。
            広告データの読み取り権限を許可してください。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800 border border-blue-100">
            <p className="font-semibold mb-1">データ利用について</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                広告キャンペーン、クリック数、コンバージョン数などのパフォーマンスデータを取得・分析します。
              </li>
              <li>取得したデータは、AIによる広告改善提案の生成のみに使用されます。</li>
              <li>
                本サービスがGoogle Adsの設定を自動で変更したり、広告を出稿することはありません。
              </li>
            </ul>
          </div>

          <GoogleSignInButton href="/api/google-ads/oauth/start">
            Googleでログイン
          </GoogleSignInButton>
        </CardContent>
      </Card>

      {isConnected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>アカウント選択</CardTitle>
              <CardDescription>
                MCCアカウントでログインした場合、配下のアカウントから分析対象とするアカウントをいつでも切り替えできます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoogleAdsAccountSelector
                initialCustomerId={connectionStatus.customerId}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>連携解除</CardTitle>
              <CardDescription>
                別のGoogleアカウントで連携し直す場合や、連携をやめる場合は解除してください。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoogleAdsSetupClient />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default async function GoogleAdsSetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authResult = await authMiddleware();
  redirectIfEmailLinkConflict(authResult);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }

  const resolvedParams = searchParams ? await searchParams : {};

  return (
    <div className="container mx-auto py-10 px-4">
      <GoogleAdsSetupContent searchParams={resolvedParams} />
    </div>
  );
}
