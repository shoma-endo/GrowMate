import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BackLinkProps {
  href: string;
  label: string;
  className?: string;
}

/**
 * 前の画面へ戻るリンク。
 * 文言は遷移先の見出し名に合わせる（例: /setup へ戻るなら「設定に戻る」）。
 */
export function BackLink({ href, label, className }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={cn('inline-flex items-center text-sm text-blue-600 hover:text-blue-800', className)}
    >
      <ArrowLeft size={16} className="mr-1.5" />
      {label}
    </Link>
  );
}
