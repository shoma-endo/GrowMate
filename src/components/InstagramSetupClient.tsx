'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InstagramGlyph } from '@/components/InstagramGlyph';
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
import { formatCount, formatPostedAt } from '@/lib/instagram-format';
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

function formatAccountType(accountType: string | null): string {
  // isInstagramProfessionalAccount と同じ正規化。公式表記（Media_Creator）と
  // 実 API の値（MEDIA_CREATOR）が食い違うため、生文字列が画面に出ないようにする。
  const normalized = accountType?.toUpperCase();
  if (normalized === 'BUSINESS') return 'ビジネス';
  if (normalized === 'MEDIA_CREATOR') return 'クリエイター';
  return accountType ?? '不明';
}

function MediaPreviewCard({ media }: { media: InstagramMediaPreview }) {
  const thumbnail = media.thumbnailUrl ?? media.mediaUrl;
  const productLabel = media.mediaProductType === 'REELS' ? 'リール' : 'フィード';
  // media_url / thumbnail_url は有効期限付き CDN URL のため、失効時は読み込みに失敗する。
  // 画像を消すだけだと空箱が残るので、URL 未設定時と同じプレースホルダーに切り替える。
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  return (
    <div className="rounded-lg border bg-white p-3 space-y-3">
      <div className="aspect-square rounded-md bg-gray-100 flex items-center justify-center overflow-hidden">
        {thumbnail && !thumbnailFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setThumbnailFailed(true)}
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>視聴 {formatCount(media.insights.views)}</span>
                </TooltipTrigger>
                <TooltipContent>視聴＝動画が再生された回数</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>いいね {formatCount(media.insights.likes ?? media.likeCount)}</span>
                </TooltipTrigger>
                <TooltipContent>いいね＝投稿にいいねした人数</TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
  // 転換前投稿の注記は失敗ではないため partialFailureMessage とは別に持つ
  const [preConversionMessage, setPreConversionMessage] = useState<string | null>(null);
  const [partialFailureMessage, setPartialFailureMessage] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(initialStatus.needsReauth ?? false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // プロフィール画像も有効期限付き CDN URL。失効時にプレースホルダーへ切り替える。
  const [profilePictureFailed, setProfilePictureFailed] = useState(false);

  const isConnected = status.connected;
  const showConnectedSuccess = connectedSuccess && isConnected && !needsReauth;

  const loadPreview = useCallback(async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    setPartialFailureMessage(null);
    setPreConversionMessage(null);
    setProfilePictureFailed(false);
    try {
      const result = await fetchInstagramPreviewData();
      if (result.success && result.data) {
        setPreview(result.data);
        if (result.data.failedCount && result.data.failedCount > 0) {
          setPartialFailureMessage(
            ERROR_MESSAGES.INSTAGRAM.PARTIAL_MEDIA_FAILURE(result.data.failedCount)
          );
        }
        if (result.data.preConversionCount && result.data.preConversionCount > 0) {
          setPreConversionMessage(
            ERROR_MESSAGES.INSTAGRAM.MEDIA_PRE_CONVERSION(result.data.preConversionCount)
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
        <BackLink href="/setup" label="設定に戻る" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-4">
          <InstagramGlyph className="text-gray-900" />
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
            {ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED}
            <div className="mt-3">
              <Button asChild className="bg-orange-700 hover:bg-orange-800">
                <Link href={OAUTH_START_PATH} onClick={() => setIsConnecting(true)}>
                  {isConnecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <AlertTriangle size={16} className="mr-2" />
                  )}
                  再認証する
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
              <Button
                asChild
                disabled={!isOauthConfigured || isConnecting}
                className="h-12 gap-4 px-4 has-[>svg]:px-4"
              >
                <Link href={OAUTH_START_PATH} onClick={() => setIsConnecting(true)}>
                  {isConnecting ? (
                    <Loader2 className="size-8 animate-spin" />
                  ) : (
                    <InstagramGlyph className="text-primary-foreground" />
                  )}
                  Instagramと連携する
                </Link>
              </Button>
            </>
          ) : (
            <>
              {preview && !needsReauth ? (
                <div className="flex items-start gap-3 text-sm text-gray-700">
                  <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                    {preview.profile.profilePictureUrl && !profilePictureFailed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.profile.profilePictureUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => setProfilePictureFailed(true)}
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
                        <span className="block mt-2">
                          この操作で削除されるのは GrowMate
                          に保存された情報だけです。Instagram側に残る連携の許可は取り消されません。完全に取り消すには、Instagramの「設定 →
                          アプリとウェブサイト」からも削除してください。
                        </span>
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
            <CardDescription>
              連携中アカウントの最新投稿と主要指標を表示します。指標はInstagram側の集計により、最大48時間ほど遅れて反映される場合があります。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {partialFailureMessage ? (
              <Alert className="bg-orange-50 border-orange-200">
                <AlertDescription className="text-orange-800">{partialFailureMessage}</AlertDescription>
              </Alert>
            ) : null}

            {/* 転換前の投稿は再試行しても取得できないため、警告色ではなく情報として出す */}
            {preConversionMessage ? (
              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-blue-900">{preConversionMessage}</AlertDescription>
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
