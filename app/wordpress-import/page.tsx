'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useLiffContext } from '@/components/LiffProvider';
import Link from 'next/link';
import { ErrorAlert } from '@/components/ErrorAlert';
import { runWordpressBulkImport } from '@/server/actions/wordpressImport.actions';
import { canRunBulkImport } from '@/authUtils';

// WordPress OAuth/認証エラーかどうかを判定
const isWordPressAuthError = (errorMessage: string | undefined): boolean => {
  if (!errorMessage) return false;
  const lowerError = errorMessage.toLowerCase();
  return (
    lowerError.includes('wordpress oauth') ||
    lowerError.includes('wordpress unauthorized') ||
    lowerError.includes('wordpress認証') ||
    lowerError.includes('wordpress token') ||
    lowerError.includes('wordpress.com token') ||
    (lowerError.includes('invalid_grant') && lowerError.includes('wordpress')) ||
    lowerError.includes('wordpress連携が設定されていません') ||
    lowerError.includes('wordpress.com oauth')
  );
};

interface ImportResult {
  totalPosts: number;
  newPosts: number;
  updatedPosts: number;
  skippedExistingPosts: number;
  skippedWithoutCanonical: number;
  insertedPosts: number;
  duplicatePosts: number;
  errorPosts: number;
  existingContentTotal: number;
  contentTypes: string[];
  statsByType: Record<
    string,
    {
      totalAvailable: number;
      retrieved: number;
      newCandidates: number;
      skippedExisting: number;
      skippedWithoutCanonical: number;
      processed: number;
      duplicate: number;
      error: number;
    }
  >;
  maxLimitReached?: boolean;
  maxLimitValue?: number;
  backfilledTitles?: number;
}

export default function WordPressImportPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const { getAccessToken, user, isOwnerViewMode } = useLiffContext();
  const isStaffUser = Boolean(user?.ownerUserId);
  const canImport = canRunBulkImport({
    role: user?.role ?? null,
    ownerUserId: user?.ownerUserId,
    isOwnerViewMode,
  });

  if (!canImport) {
    return (
      <div className="w-full px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <Alert>
            <AlertDescription>
              {isStaffUser
                ? 'この画面はオーナーのみ利用できます。オーナーでログインしてください。'
                : '閲覧モードでは操作できません。通常モードに切り替えてください。'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const formatTypeLabel = (type: string) => {
    const lowered = type.toLowerCase();
    if (lowered === 'posts') return '投稿';
    if (lowered === 'pages') return '固定ページ';
    return `カスタム投稿（${type}）`;
  };

  const normalizeResult = (data: unknown): ImportResult => {
    if (!data || typeof data !== 'object') {
      return {
        totalPosts: 0,
        newPosts: 0,
        updatedPosts: 0,
        skippedExistingPosts: 0,
        skippedWithoutCanonical: 0,
        insertedPosts: 0,
        duplicatePosts: 0,
        errorPosts: 0,
        existingContentTotal: 0,
        contentTypes: [],
        statsByType: {},
        maxLimitReached: false,
        maxLimitValue: 1000,
        backfilledTitles: 0,
      };
    }

    const payload = data as Record<string, unknown>;
    return {
      totalPosts: typeof payload.totalPosts === 'number' ? payload.totalPosts : 0,
      newPosts: typeof payload.newPosts === 'number' ? payload.newPosts : 0,
      updatedPosts: typeof payload.updatedPosts === 'number' ? payload.updatedPosts : 0,
      skippedExistingPosts:
        typeof payload.skippedExistingPosts === 'number' ? payload.skippedExistingPosts : 0,
      skippedWithoutCanonical:
        typeof payload.skippedWithoutCanonical === 'number' ? payload.skippedWithoutCanonical : 0,
      insertedPosts: typeof payload.insertedPosts === 'number' ? payload.insertedPosts : 0,
      duplicatePosts: typeof payload.duplicatePosts === 'number' ? payload.duplicatePosts : 0,
      errorPosts: typeof payload.errorPosts === 'number' ? payload.errorPosts : 0,
      existingContentTotal:
        typeof payload.existingContentTotal === 'number' ? payload.existingContentTotal : 0,
      contentTypes: Array.isArray(payload.contentTypes) ? (payload.contentTypes as string[]) : [],
      statsByType:
        typeof payload.statsByType === 'object' && payload.statsByType !== null
          ? (payload.statsByType as ImportResult['statsByType'])
          : {},
      maxLimitReached: Boolean(payload.maxLimitReached),
      maxLimitValue:
        typeof payload.maxLimitValue === 'number' && !Number.isNaN(payload.maxLimitValue)
          ? payload.maxLimitValue
          : 1000,
      backfilledTitles:
        typeof payload.backfilledTitles === 'number' && !Number.isNaN(payload.backfilledTitles)
          ? payload.backfilledTitles
          : 0,
    };
  };

  const handleImport = async () => {
    setIsLoading(true);
    setError(undefined);
    setResult(null);

    try {
      const token = await getAccessToken();
      const response = await runWordpressBulkImport(token);

      if (!response.success) {
        throw new Error(response.error || 'インポートに失敗しました');
      }

      setResult(normalizeResult(response.data));
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('LIFF') || err.message.includes('logged in')) {
          setError('LIFFアクセストークンを取得できません。LINEで再ログインしてください。');
        } else {
          setError(err.message);
        }
      } else {
        setError('不明なエラーが発生しました');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">WordPress記事一括インポート</h1>
          <p className="text-gray-600 mt-2">
            WordPressブログ記事URLをコンテンツとして一括登録します。
            既に登録されているURLはスキップされます。
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
            <CardTitle>インポート実行</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700">
                WordPressブログ記事URLを一括取得し、コンテンツとして登録します。
              </p>
            </div>

            <Button onClick={handleImport} disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  インポート実行中...
                </>
              ) : (
                'WordPress記事を一括インポート'
              )}
            </Button>
          </CardContent>
        </Card>

        {error &&
          (isWordPressAuthError(error) ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-3">
                <p>
                  WordPress との連携が切れているか、設定されていません。
                  <br />
                  再度連携を行ってください。
                </p>
                <Link href="/setup">
                  <Button variant="outline" size="sm">
                    設定ページで再連携する
                  </Button>
                </Link>
              </AlertDescription>
            </Alert>
          ) : (
            <ErrorAlert error={error} />
          ))}

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span>インポート完了</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.maxLimitReached && (
                <Alert
                  variant="default"
                  className="mb-4 border-yellow-300 bg-yellow-50 text-yellow-800"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    最大取得件数（{result.maxLimitValue ?? 1000}
                    件）に達したため、これ以上のコンテンツは取得できませんでした。
                    投稿タイプや期間を絞り込んで再実行することをご検討ください。
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{result.totalPosts}</div>
                  <div className="text-sm text-gray-600">取得記事数</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{result.newPosts}</div>
                  <div className="text-sm text-gray-600">新規登録対象</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{result.insertedPosts}</div>
                  <div className="text-sm text-gray-600">登録成功</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-600">{result.updatedPosts}</div>
                  <div className="text-sm text-gray-600">更新件数</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {result.skippedExistingPosts}
                  </div>
                  <div className="text-sm text-gray-600">変更なしでスキップ</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{result.duplicatePosts}</div>
                  <div className="text-sm text-gray-600">重複スキップ</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{result.errorPosts}</div>
                  <div className="text-sm text-gray-600">エラー</div>
                </div>
              </div>
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-700">
                  WordPressから{result.totalPosts}件の記事を取得しました。
                  <br />• 対象タイプ:{' '}
                  {result.contentTypes.length > 0
                    ? result.contentTypes.map(formatTypeLabel).join(', ')
                    : '検出されませんでした'}
                  <br />• {result.newPosts}件を新規登録対象として処理
                  <br />• {result.updatedPosts}件を既存更新
                  <br />• {result.insertedPosts}件を新規登録
                  <br />• {result.skippedExistingPosts}件を変更なしとしてスキップ
                  <br />• {result.skippedWithoutCanonical}件をURL不足などでスキップ
                  <br />• {result.duplicatePosts}件が重複のためスキップ
                  <br />• {result.errorPosts}件でエラーが発生
                  <br />• 実行前の登録済みコンテンツ総数: {result.existingContentTotal}件
                  {typeof result.backfilledTitles === 'number' && result.backfilledTitles > 0 && (
                    <>
                      <br />• タイトル補完 {result.backfilledTitles}件
                    </>
                  )}
                </p>
              </div>

              {Object.keys(result.statsByType).length > 0 && (
                <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700">タイプ別内訳</h3>
                  <div className="mt-3 space-y-3 text-xs text-gray-700">
                    {Object.entries(result.statsByType).map(([type, stats]) => (
                      <div
                        key={type}
                        className="border-b border-gray-100 pb-3 last:border-none last:pb-0"
                      >
                        <div className="text-sm font-medium text-gray-800">
                          {`${formatTypeLabel(type)}（取得 ${stats.retrieved}/${stats.totalAvailable}）`}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-gray-600">
                          <span>新規候補 {stats.newCandidates}</span>
                          <span>登録/更新 {stats.processed}</span>
                          <span>既存スキップ {stats.skippedExisting}</span>
                          <span>URL不足 {stats.skippedWithoutCanonical}</span>
                          <span>重複 {stats.duplicate}</span>
                          <span>エラー {stats.error}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
