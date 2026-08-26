/**
 * 記事詳細画面のパスを組み立てる。
 *
 * 記事詳細は `/gsc-dashboard?annotationId=<id>`（クエリ文字列）から
 * `/analytics/[annotationId]`（動的セグメント）へ移設された。
 * 移設時に `next.config` の 308 redirect は `/gsc-dashboard` にだけ用意され、
 * `/analytics` は `annotationId` クエリを解釈しない。このため
 * `/analytics?annotationId=<id>` を指すリンクは黙ってコンテンツ一覧へ落ちる。
 *
 * 実際に GA4 ダッシュボードのランキングがこの形のまま残っており、
 * どの記事をクリックしても一覧へ飛ぶ不具合になっていた。
 * 組み立てを1か所へ集約して同種の取り違えを防ぐ。
 */
export function annotationDetailPath(annotationId: string): string {
  return `/analytics/${encodeURIComponent(annotationId)}`;
}
