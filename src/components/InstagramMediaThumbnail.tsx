'use client';

import * as React from 'react';
import Image from 'next/image';

interface InstagramMediaThumbnailProps {
  /**
   * `igMediaId` 未指定時のみ使う直接URL（プロフィール画像・setup のライブプレビュー用）。
   * `igMediaId` 指定時は無視される — 呼び出し側もそもそも渡さないこと。
   */
  src?: string | null;
  /**
   * 指定時は `src` の代わりに `/api/instagram/media/{igMediaId}/thumbnail`（自前キャッシュ
   * ルート）を使う。DB由来の投稿一覧（InstagramMediaTable）用。Meta の生URLはクライアントに
   * 一切渡さない（docs/plans/instagram-media-url-refresh-design.md §4）。
   */
  igMediaId?: string;
  /** 失敗時・URL 未設定時に表示するプレースホルダー */
  fallback: React.ReactNode;
  /** Image に渡す className（object-cover 等）。サイズは呼び出し側のコンテナで決める */
  className?: string;
}

/**
 * thumbnail_url / media_url は有効期限付き CDN URL のため、失効時は読み込みに失敗する。
 * 空箱のまま残すと壊れて見えるので、失敗時はプレースホルダーに切り替える。
 * セットアップ画面（InstagramSetupClient）・検索順位・コンテンツ評価（InstagramMediaTable）で共通利用。
 *
 * fill レイアウトのため、呼び出し側は `relative` かつサイズ確定済みのコンテナで囲むこと。
 */
export function InstagramMediaThumbnail({
  src,
  igMediaId,
  fallback,
  className,
}: InstagramMediaThumbnailProps) {
  const resolvedSrc = igMediaId ? `/api/instagram/media/${igMediaId}/thumbnail` : (src ?? null);
  const [failed, setFailed] = React.useState(false);
  // src が変わったら失敗状態をリセットする（同一インスタンスが再利用され続けても、
  // 更新後の新しい URL で再度読み込みを試みられるように）。
  const prevSrcRef = React.useRef(resolvedSrc);
  if (prevSrcRef.current !== resolvedSrc) {
    prevSrcRef.current = resolvedSrc;
    if (failed) {
      setFailed(false);
    }
  }

  if (!resolvedSrc || failed) {
    return <>{fallback}</>;
  }

  return (
    <Image
      src={resolvedSrc}
      alt=""
      fill
      unoptimized
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
