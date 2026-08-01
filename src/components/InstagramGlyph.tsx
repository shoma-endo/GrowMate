import { cn } from '@/lib/utils';

/**
 * Instagram 公式グリフ。Meta Brand Resource Center のガイドラインに従う。
 *
 * - Meta App Review の項目 "Verify that the login button or link is visible in your app
 *   and screencast, and adheres to our brand guidelines" に対応するブランド表示。
 * - 色は呼び出し側が className（currentColor）で指定する。
 * - path の改変（回転・変形・エフェクト付与・比率変更）は禁止。
 * - サイズ既定は 32px。className に `size-*` を含めているのは、shadcn Button の
 *   `[&_svg]:size-4` に上書きされないようにするため。
 * - **未確認**: 許容カラーバリエーション・最小サイズ・クリアスペースの具体値は
 *   Brand Resource Center（meta.com/brand/resources/instagram/icons）にあるが、
 *   2026-08-01 時点で本文を取得できず裏取りできていない。Business Login for Instagram の
 *   公式ドキュメントにボタン仕様（配色・サイズ・フォント）の指定は無い。
 * - 用途は「連携ボタンでのブランド表示」に限定する。要再認証ボタンは他連携と揃えて
 *   lucide の AlertTriangle を使う。
 * - growmate-ui-ux の「アイコンは lucide-react」規約に対する、ブランドアセットとしての例外。
 */
export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={cn('size-8 shrink-0', className)}
    >
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}
