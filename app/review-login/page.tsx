import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReviewLoginForm } from '@/components/ReviewLoginForm';

/**
 * Meta App Review のレビュアー専用ログイン経路。
 * 既存の /login（メール OTP）は変更しない。審査終了後は REVIEW_LOGIN_EMAIL を
 * 削除するだけでこの経路ごと 404 になる（Server Action 側も同じ変数で塞がる）。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ReviewLoginPage() {
  if (!process.env.REVIEW_LOGIN_EMAIL?.trim()) {
    notFound();
  }

  return (
    // AuthProvider が既に <main> を出しているため、ここは <div> にする（入れ子の <main> は不正）
    <div className="flex min-h-screen items-center justify-center p-4">
      <ReviewLoginForm />
    </div>
  );
}
