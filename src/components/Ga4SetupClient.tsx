'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Ga4ConnectionStage, Ga4ConnectionStatus } from '@/types/ga4';
import { ArrowLeft, Plug, RefreshCw, AlertTriangle, BarChart3, Loader2 } from 'lucide-react';
import {
  saveGa4Settings,
  refetchGa4StatusWithValidation,
} from '@/server/actions/ga4Setup.actions';
import { formatDate } from '@/lib/date-utils';
import { useGa4Setup } from '@/hooks/useGa4Setup';
import { handleAsyncAction } from '@/lib/async-handler';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { useLiffContext } from '@/components/LiffProvider';
import { toast } from 'sonner';

interface Ga4SetupClientProps {
  initialStatus: Ga4ConnectionStatus;
  isOauthConfigured: boolean;
}

const OAUTH_START_PATH = '/api/gsc/oauth/start?returnTo=/setup/ga4';
const GA4_EVENT_LABELS: Record<string, string> = {
  scroll_90: '90%スクロール',
  purchase: '購入完了',
  close_convert_lead: 'リード獲得完了（クローズ）',
  qualify_lead: '有望リード判定',
};
const GA4_STAGE_META: Record<Ga4ConnectionStage, { label: string; className: string }> = {
  unlinked: { label: '未連携', className: 'bg-gray-100 text-gray-800' },
  linked_unselected: { label: '連携済み未選択', className: 'bg-amber-100 text-amber-800' },
  configured: { label: '設定完了', className: 'bg-green-100 text-green-800' },
};

type Ga4ManualSyncData =
  | { alreadySynced: true }
  | { startDate: string; endDate: string; upserted: number };

const getGa4EventLabel = (eventName: string): string => {
  return GA4_EVENT_LABELS[eventName] ?? eventName;
};

export default function Ga4SetupClient({ initialStatus, isOauthConfigured }: Ga4SetupClientProps) {
  const { user } = useLiffContext();
  const {
    status,
    properties,
    keyEvents,
    isSyncingStatus,
    isLoadingProperties,
    isLoadingKeyEvents,
    alertMessage,
    setStatus,
    setAlertMessage,
    refreshStatus,
    refetchKeyEvents,
  } = useGa4Setup(initialStatus);

  const isStaffUser = Boolean(user?.ownerUserId);
  const isReadOnly = isStaffUser;
  const [isSavingGa4, setIsSavingGa4] = useState(false);
  const [isGa4Syncing, setIsGa4Syncing] = useState(false);
  const [isCheckingGa4Status, setIsCheckingGa4Status] = useState(false);

  const [selectedGa4PropertyId, setSelectedGa4PropertyId] = useState(status.propertyId ?? '');
  const [selectedGa4Events, setSelectedGa4Events] = useState<string[]>(status.conversionEvents ?? []);
  const [ga4EngagementThreshold, setGa4EngagementThreshold] = useState<string>(
    status.thresholdEngagementSec != null ? String(status.thresholdEngagementSec) : ''
  );
  const [ga4ReadRateThreshold, setGa4ReadRateThreshold] = useState<string>(
    status.thresholdReadRate != null ? String(status.thresholdReadRate) : ''
  );
  const isGa4DirtyRef = useRef(false);
  const [ga4NeedsReauth, setGa4NeedsReauth] = useState(false);

  const connectedGa4Property = useMemo(() => {
    if (!selectedGa4PropertyId) return null;
    return properties.find(property => property.propertyId === selectedGa4PropertyId) ?? null;
  }, [selectedGa4PropertyId, properties]);

  const ga4ScopeMissing = status.scopeMissing ?? false;
  const stageMeta = GA4_STAGE_META[status.connectionStage];
  const isGa4Linked = status.connectionStage !== 'unlinked';
  const isGa4Configured = status.connectionStage === 'configured';

  const handleGa4PropertyChange = (value: string) => {
    isGa4DirtyRef.current = true;
    setSelectedGa4PropertyId(value);
    setSelectedGa4Events([]);
  };

  const handleGa4EventToggle = (eventName: string, checked: boolean) => {
    isGa4DirtyRef.current = true;
    setSelectedGa4Events(prev => {
      if (checked) {
        return Array.from(new Set([...prev, eventName]));
      }
      return prev.filter(name => name !== eventName);
    });
  };

  const handleSaveGa4Settings = async () => {
    const parsedEngagement =
      ga4EngagementThreshold.trim() === '' ? undefined : Number(ga4EngagementThreshold);
    const parsedReadRate = ga4ReadRateThreshold.trim() === '' ? undefined : Number(ga4ReadRateThreshold);
    const thresholdEngagement = Number.isNaN(parsedEngagement) ? undefined : parsedEngagement;
    const thresholdReadRate = Number.isNaN(parsedReadRate) ? undefined : parsedReadRate;

    await handleAsyncAction(
      () =>
        saveGa4Settings({
          propertyId: selectedGa4PropertyId,
          propertyName: connectedGa4Property?.displayName ?? undefined,
          conversionEvents: selectedGa4Events,
          thresholdEngagementSec: thresholdEngagement,
          thresholdReadRate,
        }),
      {
        onSuccess: data => {
          isGa4DirtyRef.current = false;
          setStatus(data as Ga4ConnectionStatus);
          toast.success('GA4設定を保存しました');
        },
        setLoading: setIsSavingGa4,
        setMessage: setAlertMessage,
        defaultErrorMessage: 'GA4設定の保存に失敗しました',
      }
    );
  };

  const handleGa4ManualSync = async () => {
    await handleAsyncAction<Ga4ManualSyncData>(
      async () => {
        const response = await fetch('/api/ga4/sync', { method: 'POST' });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `GA4同期に失敗しました (HTTP ${response.status})`);
        }
        const json = (await response.json()) as {
          success: boolean;
          error?: string;
          data?: Ga4ManualSyncData;
        };
        if (!json.success) {
          throw new Error(json.error || 'GA4同期に失敗しました');
        }
        return json;
      },
      {
        onSuccess: (result) => {
          if (!result || 'alreadySynced' in result) {
            toast.info('本日分は同期済みです');
            return;
          }
          toast.success(
            `GA4データを同期しました（${result.startDate} 〜 ${result.endDate}、${result.upserted}件）`
          );
        },
        setLoading: setIsGa4Syncing,
        setMessage: setAlertMessage,
        defaultErrorMessage: 'GA4同期に失敗しました',
      }
    );
  };

  const handleRefreshGa4Status = useCallback(async () => {
    setIsCheckingGa4Status(true);
    setAlertMessage(null);
    try {
      const result = await refetchGa4StatusWithValidation();
      if (result.success) {
        setStatus(result.data);
        setGa4NeedsReauth(result.needsReauth);
      } else {
        setGa4NeedsReauth(false);
        setAlertMessage(result.error || 'GA4ステータスの取得に失敗しました');
      }
    } catch (error) {
      console.error('GA4ステータス取得エラー:', error);
      setGa4NeedsReauth(false);
      setAlertMessage('GA4ステータスの取得に失敗しました');
    } finally {
      setIsCheckingGa4Status(false);
    }
  }, [setAlertMessage, setStatus]);

  useEffect(() => {
    if (isGa4DirtyRef.current) {
      return;
    }
    setSelectedGa4PropertyId(status.propertyId ?? '');
    setSelectedGa4Events(Array.isArray(status.conversionEvents) ? status.conversionEvents : []);
    setGa4EngagementThreshold(
      status.thresholdEngagementSec != null ? String(status.thresholdEngagementSec) : ''
    );
    setGa4ReadRateThreshold(status.thresholdReadRate != null ? String(status.thresholdReadRate) : '');
  }, [
    status.propertyId,
    status.conversionEvents,
    status.thresholdEngagementSec,
    status.thresholdReadRate,
  ]);

  useEffect(() => {
    if (selectedGa4PropertyId) {
      refetchKeyEvents(selectedGa4PropertyId);
    }
  }, [selectedGa4PropertyId, refetchKeyEvents]);

  useEffect(() => {
    setGa4NeedsReauth(status.needsReauth ?? false);
  }, [status.needsReauth]);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="mb-8">
        <Link href="/setup" className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4">
          <ArrowLeft size={20} className="mr-2" />
          設定ダッシュボードに戻る
        </Link>
        <div className="flex items-center gap-3 mb-4">
          <Plug className="text-emerald-500" size={32} />
          <h1 className="text-3xl font-bold">Google Analytics 4 連携</h1>
        </div>
        <p className="text-gray-600">
          Google Analytics 4から行動データを取得し、コンテンツ改善の意思決定に活用します。
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

      {ga4NeedsReauth && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-orange-800">
            <AlertTriangle className="h-5 w-5" />
            <p className="font-semibold">GA4の再認証が必要です</p>
          </div>
          <div className="text-sm text-orange-700 space-y-2">
            <p>
              GA4の権限が不足しているか、認証トークンが期限切れまたは取り消しされています。再認証してください。
            </p>
            {ga4ScopeMissing && <p>GA4の読み取り権限を追加するため、再認証が必要です。</p>}
          </div>
        </div>
      )}

      {alertMessage && !ga4NeedsReauth && (
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
            onClick={handleRefreshGa4Status}
            disabled={isSyncingStatus || isCheckingGa4Status || isReadOnly}
            className="flex items-center gap-1"
          >
            <RefreshCw
              className={`h-4 w-4 ${isSyncingStatus || isCheckingGa4Status ? 'animate-spin' : ''}`}
            />
            再読込
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-gray-500">現在の状態</span>
              <Badge
                variant="outline"
                className={ga4NeedsReauth ? 'bg-orange-100 text-orange-800' : stageMeta.className}
              >
                {ga4NeedsReauth ? '要再認証' : stageMeta.label}
              </Badge>
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

          {isGa4Linked && (
            <div className="grid gap-3 text-sm text-gray-700">
              <div>
                <span className="font-medium text-gray-500 block">Googleアカウント</span>
                <span>{status.googleAccountEmail ?? '取得中...'}</span>
              </div>
              <div>
                <span className="font-medium text-gray-500 block">接続プロパティ</span>
                <span>{status.propertyName ?? status.propertyId ?? '未選択'}</span>
              </div>
              <div>
                <span className="font-medium text-gray-500 block">CVイベント数</span>
                <span>{status.conversionEvents?.length ?? 0}件</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {status.lastSyncedAt && (
                  <Badge variant="outline">最終同期: {formatDate(status.lastSyncedAt)}</Badge>
                )}
                {status.updatedAt && (
                  <Badge variant="outline">最終更新: {formatDate(status.updatedAt)}</Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">GA4 設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!isGa4Linked ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              Googleでログインして連携を完了すると、GA4プロパティと前段CVイベントを設定できます。
            </div>
          ) : (
            <>
              {!isGa4Configured && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  連携済みですが、GA4プロパティが未選択です。プロパティを選択して保存してください。
                </div>
              )}

              <div className="space-y-2">
                <span className="text-sm font-medium text-gray-700">プロパティ</span>
                <Select
                  value={selectedGa4PropertyId || ''}
                  onValueChange={handleGa4PropertyChange}
                  disabled={isReadOnly || isLoadingProperties || properties.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="GA4プロパティを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map(property => (
                      <SelectItem key={property.propertyId} value={property.propertyId}>
                        <div className="flex flex-col">
                          <span>{property.displayName}</span>
                          <span className="text-xs text-gray-500">{property.propertyId}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-xs text-gray-500">
                  {isLoadingProperties && 'GA4プロパティ一覧を取得中です...'}
                  {!isLoadingProperties && properties.length === 0 && (
                    <span>権限のあるGA4プロパティが見つかりません。</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-gray-700">前段CVイベント</span>
                <p className="text-xs text-gray-500">
                  GA4のキーイベントから前段CVとして扱うイベントを選択してください（90%スクロールは自動で保存されます）。
                </p>
                <div className="rounded-md border border-gray-200 p-3 space-y-2">
                  {isLoadingKeyEvents ? (
                    <p className="text-xs text-gray-500">キーイベントを取得中です...</p>
                  ) : keyEvents.length === 0 ? (
                    <p className="text-xs text-gray-500">選択可能なキーイベントがありません。</p>
                  ) : (
                    keyEvents.map(event => (
                      <div key={event.eventName} className="flex items-center gap-2">
                        <Checkbox
                          id={`ga4-event-${event.eventName}`}
                          checked={selectedGa4Events.includes(event.eventName)}
                          onCheckedChange={checked =>
                            handleGa4EventToggle(event.eventName, Boolean(checked))
                          }
                          disabled={isReadOnly}
                        />
                        <Label htmlFor={`ga4-event-${event.eventName}`} className="text-sm">
                          {getGa4EventLabel(event.eventName)}
                        </Label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ga4-engagement-threshold">滞在時間の閾値（秒）</Label>
                  <Input
                    id="ga4-engagement-threshold"
                    type="number"
                    min={0}
                    value={ga4EngagementThreshold}
                    onChange={event => {
                      isGa4DirtyRef.current = true;
                      setGa4EngagementThreshold(event.target.value);
                    }}
                    disabled={isReadOnly}
                    placeholder="例: 60"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ga4-readrate-threshold">読了率の閾値（0〜1）</Label>
                  <Input
                    id="ga4-readrate-threshold"
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={ga4ReadRateThreshold}
                    onChange={event => {
                      isGa4DirtyRef.current = true;
                      setGa4ReadRateThreshold(event.target.value);
                    }}
                    disabled={isReadOnly}
                    placeholder="例: 0.4"
                  />
                </div>
              </div>

              {connectedGa4Property && (
                <div className="rounded-md bg-gray-50 p-4 text-sm text-gray-700 space-y-1">
                  <div>
                    <span className="font-medium">プロパティ:</span> {connectedGa4Property.displayName}
                  </div>
                  <div>
                    <span className="font-medium">ID:</span> {connectedGa4Property.propertyId}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={refreshStatus}
                  disabled={isReadOnly || isSyncingStatus}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${isSyncingStatus ? 'animate-spin' : ''}`} />
                  ステータス再取得
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveGa4Settings}
                  disabled={isReadOnly || isSavingGa4 || !selectedGa4PropertyId}
                  className="flex items-center gap-2"
                >
                  {isSavingGa4 && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSavingGa4 ? '保存中...' : '保存'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGa4ManualSync}
                  disabled={isReadOnly || isGa4Syncing || !status.propertyId}
                  className="flex items-center gap-2"
                >
                  {isGa4Syncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                  {isGa4Syncing ? '同期中...' : 'GA4日次同期を実行'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">GA4 連携ガイド</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 text-sm text-gray-700">
            <div>
              <h4 className="font-medium mb-2">連携手順</h4>
              <ol className="list-decimal list-inside space-y-1 ml-4">
                <li>上部の「Googleでログイン」ボタンでOAuth認可を完了</li>
                <li>利用可能なGA4プロパティを選択して保存</li>
                <li>前段CVとして扱うキーイベントと閾値を設定</li>
              </ol>
            </div>
            <div>
              <h4 className="font-medium mb-2">必要な権限</h4>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>対象GA4プロパティの閲覧権限が必要です</li>
                <li>読み取り専用スコープ（analytics.readonly）を使用します</li>
                <li>データの書き込み・削除は一切行いません</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">トラブルシューティング</h4>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>プロパティが表示されない: GA4側の権限を確認してください</li>
                <li>接続エラーが出る: 再読込ボタンで最新状態を取得してください</li>
                <li>認証がうまくいかない: Googleで再認証を実行してください</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
