'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Settings,
  Plug,
  Loader2,
  ShieldCheck,
  ShieldOff,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { SetupDashboardProps } from '@/types/components';
import type { Ga4ConnectionStage } from '@/types/ga4';
import { refetchGscStatusWithValidation } from '@/server/actions/gscSetup.actions';
import { refetchGa4StatusWithValidation } from '@/server/actions/ga4Setup.actions';
import {
  fetchWordPressStatusAction,
  type WordPressConnectionStatus,
} from '@/server/actions/wordpress.actions';
import { useServerAction } from '@/hooks/useServerAction';
import { useLiffContext } from '@/components/LiffProvider';

const GA4_STAGE_META: Record<Ga4ConnectionStage, { label: string; className: string }> = {
  unlinked: { label: '未連携', className: 'bg-gray-100 text-gray-800' },
  linked_unselected: { label: '連携済み未選択', className: 'bg-amber-100 text-amber-800' },
  configured: { label: '設定完了', className: 'bg-green-100 text-green-800 hover:bg-green-200' },
};

export default function SetupDashboard({
  wordpressSettings,
  gscStatus,
  ga4Status,
  googleAdsStatus,
  isAdmin,
}: SetupDashboardProps) {
  const { isOwnerViewMode, user } = useLiffContext();
  const [wpStatus, setWpStatus] = useState<WordPressConnectionStatus | null>(null);
  const [gscConnection, setGscConnection] = useState(gscStatus);
  const [gscNeedsReauth, setGscNeedsReauth] = useState(false);
  const [isLoadingGscStatus, setIsLoadingGscStatus] = useState(false);
  const [ga4Connection, setGa4Connection] = useState(ga4Status);
  const [ga4NeedsReauth, setGa4NeedsReauth] = useState(false);
  const [isLoadingGa4Status, setIsLoadingGa4Status] = useState(false);
  const isStaffUser = Boolean(user?.ownerUserId);
  const isReadOnly = isOwnerViewMode || isStaffUser;
  const ga4StageMeta = GA4_STAGE_META[ga4Connection.connectionStage];
  const isGa4Configured = ga4Connection.connectionStage === 'configured';
  const isGa4LinkedUnselected = ga4Connection.connectionStage === 'linked_unselected';

  const { execute: fetchWpStatus, isLoading: isLoadingStatus } =
    useServerAction<WordPressConnectionStatus>();

  // WordPress接続ステータスを取得
  useEffect(() => {
    fetchWpStatus(fetchWordPressStatusAction, {
      onSuccess: setWpStatus,
      defaultErrorMessage: 'ステータス取得に失敗しました',
    });
  }, [wordpressSettings.hasSettings, fetchWpStatus]);

  useEffect(() => {
    setGscConnection(gscStatus);
  }, [gscStatus]);

  useEffect(() => {
    setGa4Connection(ga4Status);
  }, [ga4Status]);

  const refetchGscStatus = useCallback(async () => {
    setGscNeedsReauth(false);
    setIsLoadingGscStatus(true);
    try {
      const result = await refetchGscStatusWithValidation();
      if (result.success) {
        setGscConnection(result.data);
        setGscNeedsReauth(result.needsReauth);
      } else {
        console.error('GSCステータス取得エラー:', result.error);
      }
    } catch (error) {
      console.error('GSCステータス取得エラー:', error);
    } finally {
      setIsLoadingGscStatus(false);
    }
  }, []);

  useEffect(() => {
    refetchGscStatus();
  }, [refetchGscStatus]);

  const refetchGa4Status = useCallback(async () => {
    setGa4NeedsReauth(false);
    setIsLoadingGa4Status(true);
    try {
      const result = await refetchGa4StatusWithValidation();
      if (result.success) {
        setGa4Connection(result.data);
        setGa4NeedsReauth(result.needsReauth);
      } else {
        console.error('GA4ステータス取得エラー:', result.error);
      }
    } catch (error) {
      console.error('GA4ステータス取得エラー:', error);
    } finally {
      setIsLoadingGa4Status(false);
    }
  }, []);

  useEffect(() => {
    refetchGa4Status();
  }, [refetchGa4Status]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <Link href="/" className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4">
          <ArrowLeft size={20} className="mr-2" />
          ホームに戻る
        </Link>
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">設定</h1>
          <p className="text-gray-600">各種サービス連携に必要な設定を管理します</p>
        </div>
      </div>

      {/* サービス連携 */}
      <h2 className="text-xl font-semibold mb-3">サービス連携</h2>
      <div className="grid gap-6 md:grid-cols-1">
        {/* WordPress 設定 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Plug className="text-purple-500" size={24} />
              WordPress 設定
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {wordpressSettings.hasSettings ? (
                    <>
                      <CheckCircle className="text-green-500" size={20} />
                      <span className="text-green-700 font-medium">接続済み</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="text-orange-500" size={20} />
                      <span className="text-orange-700 font-medium">未設定</span>
                    </>
                  )}
                </div>

                {/* 接続ステータスバッジ */}
                {isLoadingStatus ? (
                  <div className="flex items-center gap-1">
                    <Loader2 className="animate-spin" size={14} />
                    <Badge variant="secondary" className="text-xs">
                      確認中
                    </Badge>
                  </div>
                ) : wpStatus ? (
                  <Badge
                    variant={
                      wpStatus.connected
                        ? 'default'
                        : wpStatus.status === 'not_configured'
                          ? 'secondary'
                          : 'destructive'
                    }
                    className={`text-xs ${
                      wpStatus.connected
                        ? 'bg-green-100 text-green-800 hover:bg-green-200'
                        : wpStatus.status === 'not_configured'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-red-100 text-red-800 hover:bg-red-200'
                    }`}
                  >
                    {wpStatus.connected
                      ? '接続OK'
                      : wpStatus.status === 'not_configured'
                        ? '未設定'
                        : '接続エラー'}
                  </Badge>
                ) : null}
              </div>

              {wordpressSettings.hasSettings && (
                <div className="text-sm text-gray-600 space-y-1">
                  <p>
                    タイプ:{' '}
                    {wordpressSettings.type === 'wordpress_com' ? 'WordPress.com' : 'セルフホスト'}
                  </p>
                  {wordpressSettings.siteId && <p>サイトID: {wordpressSettings.siteId}</p>}
                  {wordpressSettings.siteUrl && <p>サイトURL: {wordpressSettings.siteUrl}</p>}

                  {/* 接続状態の詳細メッセージ */}
                  {wpStatus && wpStatus.status !== 'not_configured' && (
                    <div
                      className={`p-2 rounded text-xs ${
                        wpStatus.connected ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {wpStatus.message}
                    </div>
                  )}
                </div>
              )}

              <p className="text-sm text-gray-600">
                WordPressサイトと連携して、コンテンツの公開・更新を効率化します。
              </p>

              <div className="flex gap-2">
                <div className="flex-1">
                  <Button
                    asChild
                    variant={wordpressSettings.hasSettings ? 'outline' : 'default'}
                    className={`w-full ${wordpressSettings.hasSettings ? 'border-2 border-gray-400 hover:border-gray-500' : ''}`}
                  >
                    <Link href="/setup/wordpress">
                      <Settings size={16} className="mr-2" />
                      {wordpressSettings.hasSettings ? '設定を編集' : '設定を開始'}
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Google Search Console 連携 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Plug className="text-red-500" size={24} />
              Google Search Console 連携
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {gscNeedsReauth ? (
                    <>
                      <AlertTriangle className="text-orange-500" size={20} />
                      <span className="text-orange-700 font-medium">要再認証</span>
                    </>
                  ) : gscConnection.connected ? (
                    <>
                      <CheckCircle className="text-green-500" size={20} />
                      <span className="text-green-700 font-medium">接続済み</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="text-orange-500" size={20} />
                      <span className="text-orange-700 font-medium">未設定</span>
                    </>
                  )}
                </div>
                {isLoadingGscStatus ? (
                  <div className="flex items-center gap-1">
                    <Loader2 className="animate-spin" size={14} />
                    <Badge variant="secondary" className="text-xs">
                      確認中
                    </Badge>
                  </div>
                ) : (
                  <Badge
                    variant={
                      gscNeedsReauth ? 'default' : gscConnection.connected ? 'default' : 'secondary'
                    }
                    className={`text-xs ${
                      gscNeedsReauth
                        ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                        : gscConnection.connected
                          ? 'bg-green-100 text-green-800 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {gscNeedsReauth ? '要再認証' : gscConnection.connected ? '接続OK' : '未設定'}
                  </Badge>
                )}
              </div>

              {gscNeedsReauth ? (
                <div className="text-sm space-y-2">
                  <div className="p-3 rounded-lg bg-orange-50 border border-orange-200">
                    <p className="text-orange-800 font-medium">
                      Googleアカウントの再認証が必要です
                    </p>
                    <p className="text-orange-700 text-xs mt-1">
                      認証トークンが期限切れまたは取り消されています。再認証してください。
                    </p>
                  </div>
                  <p className="text-gray-600">
                    アカウント: {gscConnection.googleAccountEmail ?? '取得中'}
                  </p>
                </div>
              ) : gscConnection.connected ? (
                <div className="text-sm text-gray-600 space-y-1">
                  <p>アカウント: {gscConnection.googleAccountEmail ?? '取得中'}</p>
                  <p>
                    プロパティ:{' '}
                    {gscConnection.propertyDisplayName ?? gscConnection.propertyUri ?? '未選択'}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {gscConnection.permissionLevel && (
                      <Badge variant="outline">{gscConnection.permissionLevel}</Badge>
                    )}
                    {gscConnection.verified ? (
                      <Badge className="bg-green-100 text-green-800">
                        <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                        検証済み
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-600 border-red-300">
                        <ShieldOff className="h-3.5 w-3.5 mr-1" />
                        未検証
                      </Badge>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600 space-y-1">
                  <p>
                    Search
                    Consoleから検索パフォーマンス指標を取り込み、改善アクションに活用できます。
                  </p>
                  <p className="text-xs text-gray-500">
                    所有者またはフルユーザー権限が必要です。連携後にプロパティを選択してください。
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <div className="flex-1">
                  {gscNeedsReauth ? (
                    <Button asChild className="w-full bg-orange-600 hover:bg-orange-700">
                      <Link href="/setup/gsc">
                        <AlertTriangle size={16} className="mr-2" />
                        再認証する
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      asChild
                      variant={gscConnection.connected ? 'outline' : 'default'}
                      className={`w-full ${gscConnection.connected ? 'border-2 border-gray-400 hover:border-gray-500' : ''}`}
                    >
                      <Link href="/setup/gsc">
                        <Settings size={16} className="mr-2" />
                        {gscConnection.connected ? '連携を管理' : '連携を開始'}
                      </Link>
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refetchGscStatus}
                  disabled={isLoadingGscStatus || isReadOnly}
                  className="flex items-center gap-1"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingGscStatus ? 'animate-spin' : ''}`} />
                  再読込
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Google Ads 連携（管理者のみ） */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Plug className="text-emerald-500" size={24} />
              Google Analytics 4 連携
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {ga4NeedsReauth ? (
                    <>
                      <AlertTriangle className="text-orange-500" size={20} />
                      <span className="text-orange-700 font-medium">要再認証</span>
                    </>
                  ) : isGa4Configured ? (
                    <>
                      <CheckCircle className="text-green-500" size={20} />
                      <span className="text-green-700 font-medium">設定完了</span>
                    </>
                  ) : isGa4LinkedUnselected ? (
                    <>
                      <AlertCircle className="text-amber-500" size={20} />
                      <span className="text-amber-700 font-medium">連携済み未選択</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="text-orange-500" size={20} />
                      <span className="text-orange-700 font-medium">未連携</span>
                    </>
                  )}
                </div>
                {isLoadingGa4Status ? (
                  <div className="flex items-center gap-1">
                    <Loader2 className="animate-spin" size={14} />
                    <Badge variant="secondary" className="text-xs">
                      確認中
                    </Badge>
                  </div>
                ) : (
                  <Badge
                    variant={ga4NeedsReauth ? 'default' : 'secondary'}
                    className={`text-xs ${
                      ga4NeedsReauth
                        ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                        : ga4StageMeta.className
                    }`}
                  >
                    {ga4NeedsReauth ? '要再認証' : ga4StageMeta.label}
                  </Badge>
                )}
              </div>

              {ga4NeedsReauth ? (
                <div className="text-sm space-y-2">
                  <div className="p-3 rounded-lg bg-orange-50 border border-orange-200">
                    <p className="text-orange-800 font-medium">Googleアカウントの再認証が必要です</p>
                    <p className="text-orange-700 text-xs mt-1">
                      認証トークンが期限切れまたは必要な権限が不足しています。再認証してください。
                    </p>
                  </div>
                  <p className="text-gray-600">
                    アカウント: {ga4Connection.googleAccountEmail ?? '取得中'}
                  </p>
                </div>
              ) : isGa4Configured ? (
                <div className="text-sm text-gray-600 space-y-1">
                  <p>アカウント: {ga4Connection.googleAccountEmail ?? '取得中'}</p>
                  <p>
                    プロパティ: {ga4Connection.propertyName ?? ga4Connection.propertyId ?? '未選択'}
                  </p>
                  {ga4Connection.conversionEvents && (
                    <p className="text-xs text-gray-500">
                      前段CVイベント数: {ga4Connection.conversionEvents.length}件
                    </p>
                  )}
                </div>
              ) : isGa4LinkedUnselected ? (
                <div className="text-sm text-gray-600 space-y-1">
                  <p>アカウント: {ga4Connection.googleAccountEmail ?? '取得中'}</p>
                  <p className="text-amber-700">
                    Googleアカウント連携は完了しています。GA4プロパティを選択して設定を完了してください。
                  </p>
                </div>
              ) : (
                <div className="text-sm text-gray-600 space-y-1">
                  <p>
                    Google Analytics
                    4と連携し、ページごとの行動データを指標化して改善アクションに活用できます。
                  </p>
                  <p className="text-xs text-gray-500">
                    連携後に対象プロパティと前段CVイベントを設定してください。
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <div className="flex-1">
                  {ga4NeedsReauth ? (
                    <Button asChild className="w-full bg-orange-600 hover:bg-orange-700">
                      <Link href="/setup/ga4">
                        <AlertTriangle size={16} className="mr-2" />
                        再認証する
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      asChild
                      variant={isGa4Configured ? 'outline' : 'default'}
                      className={`w-full ${isGa4Configured ? 'border-2 border-gray-400 hover:border-gray-500' : ''}`}
                    >
                      <Link href="/setup/ga4">
                        <Settings size={16} className="mr-2" />
                        {isGa4Configured ? '連携を管理' : '設定を続ける'}
                      </Link>
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refetchGa4Status}
                  disabled={isLoadingGa4Status || isReadOnly}
                  className="flex items-center gap-1"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingGa4Status ? 'animate-spin' : ''}`} />
                  再読込
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isAdmin && googleAdsStatus && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Plug className="text-blue-500" size={24} />
                Google Ads 連携
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {googleAdsStatus.needsReauth ? (
                      <>
                        <AlertTriangle className="text-orange-500" size={20} />
                        <span className="text-orange-700 font-medium">要再認証</span>
                      </>
                    ) : googleAdsStatus.connected ? (
                      <>
                        <CheckCircle className="text-green-500" size={20} />
                        <span className="text-green-700 font-medium">接続済み</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="text-orange-500" size={20} />
                        <span className="text-orange-700 font-medium">未設定</span>
                      </>
                    )}
                  </div>
                  <Badge
                    variant={
                      googleAdsStatus.needsReauth
                        ? 'default'
                        : googleAdsStatus.connected
                          ? 'default'
                          : 'secondary'
                    }
                    className={`text-xs ${
                      googleAdsStatus.needsReauth
                        ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                        : googleAdsStatus.connected
                          ? 'bg-green-100 text-green-800 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {googleAdsStatus.needsReauth
                      ? '要再認証'
                      : googleAdsStatus.connected
                        ? '接続OK'
                        : '未設定'}
                  </Badge>
                </div>

                {googleAdsStatus.needsReauth ? (
                  <div className="text-sm space-y-2">
                    <div className="p-3 rounded-lg bg-orange-50 border border-orange-200">
                      <p className="text-orange-800 font-medium">
                        Googleアカウントの再認証が必要です
                      </p>
                      <p className="text-orange-700 text-xs mt-1">
                        認証トークンが期限切れまたは取り消されています。再認証してください。
                      </p>
                    </div>
                    <p className="text-gray-600">
                      アカウント: {googleAdsStatus.googleAccountEmail ?? '取得中'}
                    </p>
                  </div>
                ) : googleAdsStatus.connected ? (
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>アカウント: {googleAdsStatus.googleAccountEmail ?? '取得中'}</p>
                    {googleAdsStatus.customerId && (
                      <p className="text-xs text-gray-500">
                        選択アカウントID: {googleAdsStatus.customerId}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>
                      Google Ads アカウントと連携し、広告パフォーマンスデータを取得・分析できます。
                    </p>
                    <p className="text-xs text-gray-500">
                      ※ 現在は管理者のみ利用可能です（審査完了まで）
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="flex-1">
                    {googleAdsStatus.needsReauth ? (
                      <Button asChild className="w-full bg-orange-600 hover:bg-orange-700">
                        <Link href="/setup/google-ads">
                          <AlertTriangle size={16} className="mr-2" />
                          再認証する
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        asChild
                        variant={googleAdsStatus.connected ? 'outline' : 'default'}
                        className={`w-full ${googleAdsStatus.connected ? 'border-2 border-gray-400 hover:border-gray-500' : ''}`}
                      >
                        <Link href="/setup/google-ads">
                          <Settings size={16} className="mr-2" />
                          {googleAdsStatus.connected ? '連携を管理' : '連携を開始'}
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 初回セットアップガイド */}
      {!wordpressSettings.hasSettings && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>初回セットアップガイド</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-gray-600">
                初めてご利用の場合は、以下の順序で設定を進めることをお勧めします
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                <li className={wordpressSettings.hasSettings ? 'line-through text-gray-400' : ''}>
                  <strong>WordPress設定</strong> - 公開先サイトの設定
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
