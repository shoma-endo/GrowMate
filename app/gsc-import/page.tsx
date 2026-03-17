'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { runGscImport } from '@/server/actions/gscImport.actions';
import { fetchGscStatus } from '@/server/actions/gscSetup.actions';
import { getQuerySummaryLabels } from '@/lib/gsc-import';
import type { GscConnectionStatus } from '@/types/gsc';
import { useLiffContext } from '@/components/LiffProvider';
import { canRunBulkImport } from '@/authUtils';

type ImportResponse = {
  success: boolean;
  data?: {
    totalFetched: number;
    upserted: number;
    skipped: number;
    unmatched: number;
    evaluated: number;
    segmentCount?: number;
    querySummary?: {
      fetchedRows: number;
      keptRows: number;
      dedupedRows: number;
      fetchErrorPages: number;
      skipped: {
        missingKeys: number;
        invalidUrl: number;
        emptyQuery: number;
        zeroMetrics: number;
      };
      hitLimit: boolean;
    };
  };
  error?: string;
};

type GscStatusResponse = {
  success: boolean;
  data?: GscConnectionStatus;
  error?: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

// OAuth トークンエラーかどうかを判定
const isOAuthTokenError = (errorMessage: string | undefined): boolean => {
  if (!errorMessage) return false;
  const lowerError = errorMessage.toLowerCase();
  return (
    lowerError.includes('invalid_grant') ||
    lowerError.includes('token has been expired or revoked') ||
    lowerError.includes('oauthトークン') ||
    lowerError.includes('リフレッシュに失敗')
  );
};

export default function GscImportPage() {
  const { user, isOwnerViewMode } = useLiffContext();
  const [startDate, setStartDate] = useState(daysAgoISO(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [searchType, setSearchType] = useState<'web' | 'image' | 'news'>('web');
  const [maxRows, setMaxRows] = useState<number | ''>(1000);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [gscStatus, setGscStatus] = useState<GscStatusResponse | null>(null);
  const [isLoadingGscStatus, setIsLoadingGscStatus] = useState(true);
  const querySummaryLabels = result?.data?.querySummary
    ? getQuerySummaryLabels(result.data.querySummary)
    : null;
  const isStaffUser = Boolean(user?.ownerUserId);
  const canImport = canRunBulkImport({
    role: user?.role ?? null,
    ownerUserId: user?.ownerUserId,
    isOwnerViewMode,
  });
  const isReadOnly = !canImport;

  // 期間（日数）を計算
  const calculateDaysDiff = (start: string, end: string): number => {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));
  };

  const daysDiff = calculateDaysDiff(startDate, endDate);
  const normalizedMaxRows = maxRows === '' ? 1 : maxRows;
  const showWarning = daysDiff > 90 || normalizedMaxRows > 2000;

  useEffect(() => {
    if (isReadOnly) {
      setIsLoadingGscStatus(false);
      return;
    }
    let isMounted = true;
    const loadStatus = async () => {
      setIsLoadingGscStatus(true);
      try {
        const status = await fetchGscStatus();
        if (isMounted) {
          setGscStatus(status);
        }
      } catch (error) {
        if (isMounted) {
          setGscStatus({
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Google Search Consoleの設定情報を取得できませんでした',
          });
        }
      } finally {
        if (isMounted) {
          setIsLoadingGscStatus(false);
        }
      }
    };

    void loadStatus();
    return () => {
      isMounted = false;
    };
  }, [isReadOnly]);

  const handleSubmit = async () => {
    if (isReadOnly) return;
    setIsLoading(true);
    setResult(null);
    try {
      const resolvedMaxRows = maxRows === '' ? 1 : maxRows;
      const res = await runGscImport({
        startDate,
        endDate,
        searchType,
        maxRows: resolvedMaxRows,
        runEvaluation: false,
      });
      setResult(res);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'インポートに失敗しました',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full px-4 py-8">
      {isReadOnly ? (
        <div className="mx-auto max-w-3xl">
          <Alert>
            <AlertDescription>
              {isStaffUser
                ? 'この画面はオーナーのみ利用できます。オーナーでログインしてください。'
                : '閲覧モードでは操作できません。通常モードに切り替えてください。'}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Google Search Console 日次指標インポート
            </h1>
            <p className="text-gray-600 mt-2">
              Google Search Consoleから日次の検索パフォーマンス指標を取得し、システムに保存します。
              評価は行わず、指標データのみを保存します。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/setup"
                className="inline-flex items-center text-blue-600 hover:text-blue-800"
              >
                設定ダッシュボードを見る
              </Link>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>期間を指定してインポート</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                {isLoadingGscStatus ? (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    読み込み中...
                  </div>
                ) : gscStatus?.success && gscStatus.data ? (
                  gscStatus.data.connected ? (
                    <div className="space-y-1">
                      <p>
                        プロパティ:{' '}
                        {gscStatus.data.propertyDisplayName ??
                          gscStatus.data.propertyUri ??
                          '未選択'}
                      </p>
                      <p className="text-xs text-gray-500">
                        アカウント: {gscStatus.data.googleAccountEmail ?? '取得中'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p>Google Search Console が未接続です。</p>
                      <Link href="/setup/gsc" className="text-blue-600 hover:text-blue-800">
                        設定ページで連携する
                      </Link>
                    </div>
                  )
                ) : (
                  <div className="text-sm text-red-600">
                    {gscStatus?.error ?? 'Google Search Consoleの設定情報を取得できませんでした'}
                  </div>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="startDate" className="text-sm font-medium text-gray-700">
                    開始日
                  </label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={e => setStartDate(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="endDate" className="text-sm font-medium text-gray-700">
                    終了日
                  </label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={e => setEndDate(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">検索タイプ</span>
                  <Select
                    value={searchType}
                    onValueChange={v => setSearchType(v as typeof searchType)}
                    disabled={isReadOnly}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="web">ウェブ</SelectItem>
                      <SelectItem value="image">画像</SelectItem>
                      <SelectItem value="news">ニュース</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="maxRows" className="text-sm font-medium text-gray-700">
                    最大取得件数
                  </label>
                  <Input
                    id="maxRows"
                    type="number"
                    min={1}
                    max={25000}
                    value={maxRows}
                    onChange={e => {
                      const nextValue = e.target.value;
                      if (nextValue === '') {
                        setMaxRows('');
                        return;
                      }
                      const parsedValue = Number(nextValue);
                      if (Number.isNaN(parsedValue)) {
                        setMaxRows('');
                        return;
                      }
                      setMaxRows(Math.max(1, Math.min(25000, parsedValue)));
                    }}
                    onBlur={() => {
                      const resolvedValue = maxRows === '' ? 1 : maxRows;
                      setMaxRows(Math.max(1, Math.min(25000, resolvedValue)));
                    }}
                    disabled={isReadOnly}
                  />
                  <p className="text-xs text-gray-500">
                    推奨: 1000～2000（空欄の場合は1として扱います）
                  </p>
                </div>
              </div>

              {showWarning && (
                <Alert variant="default" className="border-amber-200 bg-amber-50">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                      aria-hidden
                    />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium mb-1">処理に時間がかかる可能性があります</p>
                      <ul className="space-y-1 text-xs">
                        {daysDiff > 90 && (
                          <li>• 期間が90日を超えています（{daysDiff}日間）。推奨: 30日以内</li>
                        )}
                        {normalizedMaxRows > 2000 && (
                          <li>• 最大取得行数が2000を超えています。推奨: 1000～2000</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </Alert>
              )}

              <Button onClick={handleSubmit} disabled={isLoading || isReadOnly} className="w-full">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    インポート実行中...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Google Search Console 指標をインポート
                  </>
                )}
              </Button>

              {result && (
                <Alert variant={result.success ? 'default' : 'destructive'}>
                  <div className="flex items-start gap-3">
                    {result.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" aria-hidden />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-600" aria-hidden />
                    )}
                    <div>
                      <p className="font-medium">
                        {result.success ? 'インポート完了' : 'インポートに失敗しました'}
                      </p>
                      <AlertDescription className="space-y-1 mt-2 text-sm">
                        {result.success && result.data ? (
                          <>
                            <div>取得件数: {result.data.totalFetched}</div>
                            <div>登録/更新: {result.data.upserted}</div>
                            <div>スキップ: {result.data.skipped}</div>
                            <div>注釈未マッチ: {result.data.unmatched}</div>
                            {typeof result.data.segmentCount === 'number' &&
                              result.data.segmentCount > 1 && (
                                <div>期間分割: {result.data.segmentCount}回</div>
                              )}
                            {result.data.querySummary && querySummaryLabels && (
                              <div className="pt-2">
                                <div className="font-medium">クエリ指標</div>
                                <div>{querySummaryLabels.fetched}</div>
                                <div>{querySummaryLabels.kept}</div>
                                <div>{querySummaryLabels.deduped}</div>
                                <div>{querySummaryLabels.fetchErrorPages}</div>
                                <div className="mt-1">
                                  除外内訳:
                                  <div className="ml-3">
                                    <div>{querySummaryLabels.missingKeys}</div>
                                    <div>{querySummaryLabels.invalidUrl}</div>
                                    <div>{querySummaryLabels.emptyQuery}</div>
                                    <div>{querySummaryLabels.zeroMetrics}</div>
                                  </div>
                                </div>
                                {querySummaryLabels.hitLimit && (
                                  <div className="mt-1 text-amber-700">
                                    {querySummaryLabels.hitLimit}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        ) : isOAuthTokenError(result.error) ? (
                          <div className="space-y-3">
                            <p>
                              Google Search Console との連携が切れています。
                              <br />
                              再度連携を行ってください。
                            </p>
                            <Link href="/setup">
                              <Button variant="outline" size="sm">
                                設定ページで再連携する
                              </Button>
                            </Link>
                          </div>
                        ) : (
                          <div>{result.error ?? '不明なエラーが発生しました'}</div>
                        )}
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
