'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { handleAsyncAction } from '@/lib/async-handler';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  disconnectInstagram,
  fetchInstagramPreviewData,
} from '@/server/actions/instagramSetup.actions';
import type {
  InstagramConnectionStatus,
  InstagramMediaPreview,
  InstagramPreviewData,
} from '@/types/instagram';

const OAUTH_START_PATH = '/api/instagram/oauth/start';

interface InstagramSetupClientProps {
  initialStatus: InstagramConnectionStatus;
  connectedSuccess: boolean;
  disconnectedSuccess: boolean;
  errorMessage: string | null;
  isOauthConfigured: boolean;
}

function formatCount(value: number | null): string {
  if (value == null) {
    return '-';
  }
  if (value >= 1000) {
    const rounded = value / 1000;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
  }
  return String(value);
}

function formatAccountType(accountType: string | null): string {
  if (accountType === 'BUSINESS') return 'ビジネス';
  if (accountType === 'MEDIA_CREATOR') return 'クリエイター';
  return accountType ?? '不明';
}

function formatPostedAt(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return `${date.getMonth() + 1}/${date.getDate()} 投稿`;
}

function MediaPreviewCard({ media }: { media: InstagramMediaPreview }) {
  const thumbnail = media.thumbnailUrl ?? media.mediaUrl;
  const productLabel = media.mediaProductType === 'REELS' ? 'リール' : 'フィード';

  return (
    <div className="rounded-lg border bg-white p-3 space-y-3">
      <div className="aspect-square rounded-md bg-gray-100 flex items-center justify-center overflow-hidden">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            onError={event => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <ImageIcon className="h-10 w-10 text-gray-400" />
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">{productLabel}</Badge>
          <span className="text-xs text-gray-500">{formatPostedAt(media.timestamp)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>リーチ {formatCount(media.insights.reach)}</span>
              </TooltipTrigger>
              <TooltipContent>リーチ＝投稿を見た人数</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {media.mediaProductType === 'REELS' ? (
            <span>視聴 {formatCount(media.insights.views)}</span>
          ) : (
            <span>いいね {formatCount(media.insights.likes ?? media.likeCount)}</span>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>保存 {formatCount(media.insights.saved)}</span>
              </TooltipTrigger>
              <TooltipContent>保存数＝投稿を保存した人数</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Button variant="link" asChild className="h-auto p-0 text-blue-600">
          <a href={media.permalink} target="_blank" rel="noopener noreferrer">
            投稿を見る
            <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
}

export default function InstagramSetupClient({
  initialStatus,
  connectedSuccess,
  disconnectedSuccess,
  errorMessage,
  isOauthConfigured,
}: InstagramSetupClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [preview, setPreview] = useState<InstagramPreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [partialFailureMessage, setPartialFailureMessage] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(initialStatus.needsReauth ?? false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const isConnected = status.connected;
  const showConnectedSuccess = connectedSuccess && isConnected && !needsReauth;

  const loadPreview = useCallback(async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    setPartialFailureMessage(null);
    try {
      const result = await fetchInstagramPreviewData();
      if (result.success && result.data) {
        setPreview(result.data);
        if (result.data.failedCount && result.data.failedCount > 0) {
          setPartialFailureMessage(
            ERROR_MESSAGES.INSTAGRAM.PARTIAL_MEDIA_FAILURE(result.data.failedCount)
          );
        }
        setNeedsReauth(false);
      } else if (result.needsReauth) {
        setNeedsReauth(true);
        setPreview(null);
        setPreviewError(ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED);
      } else {
        setPreview(null);
        setPreviewError(result.error ?? ERROR_MESSAGES.INSTAGRAM.PREVIEW_FETCH_FAILED);
      }
    } catch (error) {
      console.error('[Instagram Setup] preview load failed', error);
      setPreview(null);
      setPreviewError(ERROR_MESSAGES.INSTAGRAM.PREVIEW_FETCH_FAILED);
    } finally {
      setIsLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    setStatus(initialStatus);
    setNeedsReauth(initialStatus.needsReauth ?? false);
  }, [initialStatus]);

  useEffect(() => {
    if (isConnected && !needsReauth) {
      void loadPreview();
    }
  }, [isConnected, needsReauth, loadPreview]);

  const handleDisconnect = async () => {
    setIsDisconnectDialogOpen(false);
    await handleAsyncAction(disconnectInstagram, {
      onSuccess: () => {
        window.location.href = '/setup/instagram?disconnected=1';
      },
      setLoading: setIsDisconnecting,
      setMessage: setActionMessage,
      defaultErrorMessage: ERROR_MESSAGES.INSTAGRAM.DISCONNECT_FAILED,
    });
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-2">
        <Link
          href="/setup"
          className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          セットアップに戻る
        </Link>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <ImageIcon className="text-pink-500" size={28} />
          <h1 className="text-3xl font-bold text-gray-900">Instagram 連携</h1>
        </div>
        <p className="text-gray-600">
          リール・フィード投稿の実績データを取得し、コンテンツ改善に活用します。
        </p>
      </div>

      {!isOauthConfigured && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertTitle className="text-yellow-900">環境変数が未設定です</AlertTitle>
          <AlertDescription className="text-yellow-800">
            管理者は <code className="font-mono text-xs">INSTAGRAM_APP_ID</code>、
            <code className="font-mono text-xs">INSTAGRAM_APP_SECRET</code>、
            <code className="font-mono text-xs">INSTAGRAM_REDIRECT_URI</code> を設定してください。
          </AlertDescription>
        </Alert>
      )}

      {disconnectedSuccess && !isConnected && (
        <Alert className="bg-green-50 border-green-200">
          <AlertTitle className="text-green-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            連携を解除しました
          </AlertTitle>
          <AlertDescription className="text-green-700">
            Instagram 連携を解除しました。再度連携する場合は「Instagramと連携する」から手続きしてください。
          </AlertDescription>
        </Alert>
      )}

      {showConnectedSuccess && (
        <Alert className="bg-green-50 border-green-200">
          <AlertTitle className="text-green-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            連携完了
          </AlertTitle>
          <AlertDescription className="text-green-700">
            Instagram アカウントとの連携が完了しました。
            {status.username && (
              <span className="block mt-1">連携アカウント: @{status.username}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            連携エラー
          </AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {actionMessage && (
        <Alert variant="destructive">
          <AlertDescription>{actionMessage}</AlertDescription>
        </Alert>
      )}

      {isConnected && needsReauth && (
        <Alert className="bg-orange-50 border-orange-200">
          <AlertTitle className="text-orange-800 font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            要再認証
          </AlertTitle>
          <AlertDescription className="text-orange-700">
            Instagramの認証が期限切れです。再連携してください。
            <div className="mt-3">
              <Button asChild className="bg-orange-600 hover:bg-orange-700">
                <Link href={OAUTH_START_PATH} onClick={() => setIsConnecting(true)}>
                  {isConnecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  再連携する
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>連携ステータス</CardTitle>
            <CardDescription>
              Instagramのプロアカウント（ビジネス/クリエイター）と連携すると、投稿の実績データを自動で取得できます。
            </CardDescription>
          </div>
          {isConnected && !needsReauth ? (
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 hover:bg-green-200">連携済み</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadPreview()}
                disabled={isLoadingPreview}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                更新
              </Button>
            </div>
          ) : (
            <Badge
              className={
                needsReauth
                  ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                  : 'bg-gray-100 text-gray-800'
              }
            >
              {needsReauth ? '要再認証' : '未連携'}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!isConnected ? (
            <>
              <p className="text-sm text-gray-600">※個人アカウントは連携できません</p>
              <Button asChild disabled={!isOauthConfigured || isConnecting}>
                <Link href={OAUTH_START_PATH} onClick={() => setIsConnecting(true)}>
                  {isConnecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Instagramと連携する
                </Link>
              </Button>
            </>
          ) : (
            <>
              {preview && !needsReauth ? (
                <div className="flex items-start gap-3 text-sm text-gray-700">
                  <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                    {preview.profile.profilePictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.profile.profilePictureUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={event => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium">@{preview.profile.username ?? status.username}</p>
                    <p>アカウント種別: {formatAccountType(preview.profile.accountType)}</p>
                    <p>
                      フォロワー {formatCount(preview.profile.followersCount)} / フォロー{' '}
                      {formatCount(preview.profile.followsCount)} / 投稿{' '}
                      {formatCount(preview.profile.mediaCount)}
                    </p>
                  </div>
                </div>
              ) : null}

              {!needsReauth ? (
                <Dialog open={isDisconnectDialogOpen} onOpenChange={setIsDisconnectDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Unplug className="mr-2 h-4 w-4" />
                      )}
                      連携を解除
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Instagram連携を解除しますか？</DialogTitle>
                      <DialogDescription>
                        連携を解除すると、保存されているInstagram認証情報が削除されます。再度連携する場合は「Instagramと連携する」から手続きしてください。
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">キャンセル</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        onClick={() => void handleDisconnect()}
                        disabled={isDisconnecting}
                      >
                        {isDisconnecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        連携を解除
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {isConnected && !needsReauth ? (
        <Card>
          <CardHeader>
            <CardTitle>最新の投稿プレビュー（最大3件）</CardTitle>
            <CardDescription>連携中アカウントの最新投稿と主要指標を表示します。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {partialFailureMessage ? (
              <Alert className="bg-orange-50 border-orange-200">
                <AlertDescription className="text-orange-800">{partialFailureMessage}</AlertDescription>
              </Alert>
            ) : null}

            {previewError ? (
              <Alert variant="destructive">
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            ) : null}

            {isLoadingPreview ? (
              <div className="grid gap-4 md:grid-cols-3">
                {[0, 1, 2].map(index => (
                  <Skeleton key={index} className="h-64 w-full rounded-lg" />
                ))}
              </div>
            ) : preview && preview.media.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-3">
                {preview.media.map(media => (
                  <MediaPreviewCard key={media.id} media={media} />
                ))}
              </div>
            ) : !previewError && !isLoadingPreview && !(partialFailureMessage && preview?.media.length === 0) ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-gray-500">
                投稿がありません
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
