'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { GscConnectionStatus } from '@/types/gsc';
import {
  ArrowLeft,
  Plug,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Unplug,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { disconnectGsc, saveGscProperty } from '@/server/actions/gscSetup.actions';
import { formatDate } from '@/lib/date-utils';
import { GscStatusBadge } from '@/components/ui/GscStatusBadge';
import { useGscSetup } from '@/hooks/useGscSetup';
import { handleAsyncAction } from '@/lib/async-handler';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { useLiffContext } from '@/components/LiffProvider';

interface GscSetupClientProps {
  initialStatus: GscConnectionStatus;
  isOauthConfigured: boolean;
}

const OAUTH_START_PATH = '/api/gsc/oauth/start';
const GSC_PERMISSION_LABELS: Record<string, string> = {
  siteOwner: '所有者',
  siteFullUser: 'フル権限',
  siteRestrictedUser: '制限付き',
  siteUnverifiedUser: '未検証ユーザー',
  unknown: '不明',
};

const getGscPermissionLabel = (permissionLevel: string) => {
  return GSC_PERMISSION_LABELS[permissionLevel] ?? '不明';
};

export default function GscSetupClient({
  initialStatus,
  isOauthConfigured,
}: GscSetupClientProps) {
  const { user } = useLiffContext();
  const {
    status,
    properties,
    isSyncingStatus,
    isLoadingProperties,
    alertMessage,
    setStatus,
    setProperties,
    setAlertMessage,
    refreshStatus,
    refetchProperties,
  } = useGscSetup(initialStatus);
  const isStaffUser = Boolean(user?.ownerUserId);
  // Setup画面は閲覧モード対象外（オーナーは常に操作可能）
  const isReadOnly = isStaffUser;
  const needsReauth = status.needsReauth ?? false;
  const canImport = !isReadOnly && status.connected && Boolean(status.propertyUri) && !needsReauth;

  const [isUpdatingProperty, setIsUpdatingProperty] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const connectedProperty = useMemo(() => {
    if (!status.propertyUri) return null;
    return properties.find(property => property.siteUrl === status.propertyUri) ?? null;
  }, [status.propertyUri, properties]);

  const selectValueProps: { value?: string } = status.propertyUri
    ? { value: status.propertyUri }
    : {};

  const handlePropertyChange = async (value: string) => {
    const selected = properties.find(property => property.siteUrl === value);
    await handleAsyncAction(
      () =>
        saveGscProperty({
          propertyUri: value,
          permissionLevel: selected?.permissionLevel ?? null,
        }),
      {
        onSuccess: data => {
          setStatus(data as GscConnectionStatus);
          setAlertMessage('プロパティを保存しました');
        },
        setLoading: setIsUpdatingProperty,
        setMessage: setAlertMessage,
        defaultErrorMessage: 'プロパティの保存に失敗しました',
      }
    );
  };

  const handleDisconnect = async () => {
    await handleAsyncAction(disconnectGsc, {
      onSuccess: () => {
        setStatus({ connected: false });
        setProperties([]);
        setAlertMessage('Google Search Consoleとの連携を解除しました');
      },
      setLoading: setIsDisconnecting,
      setMessage: setAlertMessage,
      defaultErrorMessage: '連携解除に失敗しました',
    });
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      {/* ヘッダー */}
      <div className="mb-8">
        <Link
          href="/setup"
          className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          設定ダッシュボードに戻る
        </Link>
        <div className="flex items-center gap-3 mb-4">
          <Plug className="text-red-500" size={32} />
          <h1 className="text-3xl font-bold">Google Search Console 連携</h1>
        </div>
        <p className="text-gray-600">
          Google Search Consoleから検索パフォーマンス指標を取得し、広告・LP改善に活用します。
        </p>
      </div>

      {!isOauthConfigured && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          <p className="font-semibold">環境変数が未設定のため連携を開始できません。</p>
          <p className="mt-1">
            管理者は <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_ID</code>,{' '}
            <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_SECRET</code>,{' '}
            <code className="font-mono text-xs">GOOGLE_SEARCH_CONSOLE_REDIRECT_URI</code>{' '}
            を設定した上で再デプロイしてください。
          </p>
        </div>
      )}

      {/* 再認証が必要な場合の警告パネル */}
      {needsReauth && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-orange-800">
            <AlertTriangle className="h-5 w-5" />
            <p className="font-semibold">Googleアカウントの再認証が必要です</p>
          </div>
          <div className="text-sm text-orange-700 space-y-2">
            <p>認証トークンが期限切れまたは取り消されています。再認証してください。</p>
            <div>
              <p className="font-medium">考えられる理由:</p>
              <ul className="list-disc list-inside ml-2 mt-1">
                <li>長期間アクセスがなかった</li>
                <li>Googleアカウント側でアプリの連携を解除した</li>
                <li>Googleアカウントのパスワードを変更した</li>
              </ul>
            </div>
            <p className="text-sm text-orange-700">
              「連携ステータス」カード内の「Googleでログイン」ボタンから再認証してください。
            </p>
          </div>
        </div>
      )}

      {/* 通常のアラートメッセージ */}
      {alertMessage && !needsReauth && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          {alertMessage}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg font-semibold">連携ステータス</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshStatus}
            disabled={isSyncingStatus || isReadOnly}
            className="flex items-center gap-1"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncingStatus ? 'animate-spin' : ''}`} />
            再読込
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-gray-500">現在の状態</span>
              <GscStatusBadge connected={status.connected} needsReauth={needsReauth} />
            </div>
            {isOauthConfigured ? (
              isReadOnly ? (
                <Button disabled variant="outline">
                  オーナーのみ操作できます
                </Button>
              ) : (
                <GoogleSignInButton href={OAUTH_START_PATH}>Googleでログイン</GoogleSignInButton>
              )
            ) : (
              <Button disabled variant="outline">
                OAuth設定が無効です
              </Button>
            )}
          </div>

          {status.connected && (
            <div className="grid gap-3 text-sm text-gray-700">
              <div>
                <span className="font-medium text-gray-500 block">Googleアカウント</span>
                <span>{status.googleAccountEmail ?? '取得中...'}</span>
              </div>
              <div>
                <span className="font-medium text-gray-500 block">接続プロパティ</span>
                <span>{status.propertyDisplayName ?? status.propertyUri ?? '未選択'}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {status.permissionLevel && (
                  <Badge variant="secondary">
                    {getGscPermissionLabel(status.permissionLevel)}
                  </Badge>
                )}
                {status.verified ? (
                  <Badge className="bg-green-100 text-green-800">
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                    検証済み
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-red-600 border-red-300">
                    <ShieldOff className="mr-1 h-3.5 w-3.5" />
                    未検証
                  </Badge>
                )}
                {status.updatedAt && (
                  <Badge variant="outline">最終更新: {formatDate(status.updatedAt)}</Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {status.connected ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">プロパティ選択</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              権限を持つプロパティの中から、分析対象とするサイトを選択してください。
            </p>
            <div className="space-y-2">
              <span className="text-sm font-medium text-gray-700">プロパティ</span>
              <Select
                {...selectValueProps}
                onValueChange={handlePropertyChange}
                disabled={
                  isReadOnly || isLoadingProperties || isUpdatingProperty || properties.length === 0
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="プロパティを選択" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map(property => (
                    <SelectItem key={property.siteUrl} value={property.siteUrl}>
                      <div className="flex flex-col">
                        <span>{property.displayName}</span>
                        <span className="text-xs text-gray-500">
                          {getGscPermissionLabel(property.permissionLevel)}
                          {property.propertyType === 'sc-domain'
                            ? ' · ドメイン'
                            : ' · URLプレフィックス'}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-gray-500">
                {isLoadingProperties && 'プロパティ一覧を取得中です...'}
                {!isLoadingProperties && properties.length === 0 && (
                  <span>
                    権限のあるプロパティが見つかりません。Google Search
                    Console側で権限を確認してください。
                  </span>
                )}
              </div>
            </div>

            {connectedProperty && (
              <div className="rounded-md bg-gray-50 p-4 text-sm text-gray-700 space-y-1">
                <div>
                  <span className="font-medium">権限:</span>{' '}
                  {getGscPermissionLabel(connectedProperty.permissionLevel)}
                </div>
                <div>
                  <span className="font-medium">種別:</span>{' '}
                  {connectedProperty.propertyType === 'sc-domain'
                    ? 'ドメインプロパティ'
                    : 'URLプレフィックス'}
                </div>
                <div>
                  <span className="font-medium">検証:</span>{' '}
                  {connectedProperty.verified ? '済み' : '未検証'}
                </div>
              </div>
            )}

            <div className="flex gap-3 flex-wrap">
              <Button
                type="button"
                variant="outline"
                onClick={refetchProperties}
                disabled={isReadOnly || isLoadingProperties}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingProperties ? 'animate-spin' : ''}`} />
                プロパティ再取得
              </Button>
              {!canImport ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled
                  className="flex items-center gap-2"
                >
                  <BarChart3 className="h-4 w-4" />
                  Google Search Console 日次指標インポート
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  asChild
                  className="flex items-center gap-2 text-blue-600 border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  <Link href="/gsc-import">
                    <BarChart3 className="h-4 w-4" />
                    Google Search Console 日次指標インポート
                  </Link>
                </Button>
              )}
              {!canImport && (
                <p className="text-xs text-gray-500">
                  {needsReauth
                    ? '再認証が必要なため、インポートは無効です。'
                    : !status.connected
                      ? 'GSC未接続のため、インポートは無効です。'
                      : !status.propertyUri
                        ? 'プロパティを選択して保存してください。'
                        : '読み取り専用のため、インポートは無効です。'}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={handleDisconnect}
                disabled={isReadOnly || isDisconnecting}
                className="flex items-center gap-2 text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
              >
                <Unplug className="h-4 w-4" />
                連携解除
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">接続手順</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <ol className="list-decimal list-inside space-y-2">
              <li>Search Consoleで対象サイトを登録し、所有者ステータスを確認します。</li>
              <li>上部の「Googleでログイン」ボタンを押してOAuth認可を完了します。</li>
              <li>権限が確認でき次第、利用可能なプロパティが自動的に表示されます。</li>
            </ol>
            <p className="text-xs text-gray-500">
              Search
              Consoleで権限を付与する際は、サイト全体の「所有者」または「フルユーザー」権限が必要です。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 設定ガイド */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Google Search Console 連携ガイド</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 text-sm text-gray-700">
            {/* 連携手順 */}
            <div>
              <h4 className="font-medium mb-2">連携手順</h4>
              <ol className="list-decimal list-inside space-y-1 ml-4">
                <li>Search Consoleで対象サイトを登録し、所有者ステータスを確認</li>
                <li>上部の「Googleでログイン」ボタンでOAuth認可を完了</li>
                <li>権限が確認でき次第、利用可能なプロパティが自動表示されます</li>
                <li>プロパティを選択して保存</li>
              </ol>
            </div>

            {/* 必要な権限 */}
            <div>
              <h4 className="font-medium mb-2">必要な権限</h4>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Search Consoleでサイト全体の「所有者」または「フルユーザー」権限が必要です</li>
                <li>
                  読み取り専用スコープ（webmasters.readonly / analytics.readonly）を使用します
                </li>
                <li>データの書き込み・削除は一切行いません</li>
              </ul>
            </div>

            {/* トラブルシューティング */}
            <div>
              <h4 className="font-medium mb-2">トラブルシューティング</h4>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>プロパティが表示されない → Search Console側で権限を確認してください</li>
                <li>接続エラーが出る → 再読込ボタンで最新状態を取得してください</li>
                <li>認証がうまくいかない → 一度連携解除してから再度認証してください</li>
              </ul>
            </div>

            {/* 参考リンク */}
            <div>
              <h4 className="font-medium mb-2">参考リンク</h4>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  <a
                    href="https://support.google.com/webmasters/answer/7687615?hl=ja"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    所有者、ユーザー、権限の管理
                  </a>
                </li>
                <li>
                  <a
                    href="https://support.google.com/webmasters/answer/6258314?hl=ja"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Search Console の基本的な使用方法
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
