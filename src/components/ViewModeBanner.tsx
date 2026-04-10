'use client';

import React from 'react';
import { Lock, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/utils';

const statusBadgeStyles = cn(
  'pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full shadow-sm backdrop-blur-md transition-colors cursor-help',
  'bg-slate-100/50 border border-slate-200/60 text-slate-500',
  'hover:bg-slate-100/80'
);

const exitButtonStyles = cn(
  'group pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md shadow-sm backdrop-blur-md border transition-all duration-200',
  'text-xs text-slate-500 bg-white/70 border-slate-200/50',
  'hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 hover:shadow-md'
);

export function ViewModeBanner() {
  const { refreshUser } = useAuth();
  const router = useRouter();

  const handleExitViewMode = async () => {
    document.cookie = 'owner_view_mode=; path=/; max-age=0';
    document.cookie = 'owner_view_mode_employee_id=; path=/; max-age=0';

    try {
      await refreshUser();
      router.replace('/');
    } catch (error) {
      console.error('Failed to exit view mode:', error);
      toast.warning(
        '閲覧モードの終了中にエラーが発生しましたが、画面を戻します。問題が続く場合はページを再読み込みしてください。'
      );
      router.replace('/');
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 h-14 z-[60] flex items-center justify-center px-4 gap-4 pointer-events-none">
      {/* User Status Display */}
      <div className={statusBadgeStyles} title="閲覧専用のため編集はできません">
        <Lock size={14} className="text-slate-500" aria-hidden="true" />
        <span className="text-xs font-medium">閲覧モード</span>
      </div>

      {/* Exit Link (Return to my screen) */}
      <button
        onClick={handleExitViewMode}
        aria-label="閲覧モードを終了して自分の画面に戻る"
        className={exitButtonStyles}
      >
        <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        <span className="font-medium">自分の画面へ戻る</span>
      </button>
    </div>
  );
}
