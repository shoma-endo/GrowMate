'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { usePathname } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { getVisibleNavItems, isNavItemActive } from '@/lib/app-nav';
import { getRoleDisplayName } from '@/authUtils';
import { cn } from '@/lib/utils';

/**
 * アプリ共通シェル。lg（1024px）以上は左サイドバー、未満は上部バー＋左ドロワー。
 * 出し分けは CSS ブレークポイントで行う（useMobile は初回 width 0 で描画が跳ねるため使わない）。
 */
interface AppShellProps {
  showNav: boolean;
  children: React.ReactNode;
}

const BRAND_LABEL = 'GrowMate';

export function AppShell({ showNav, children }: AppShellProps) {
  if (!showNav) {
    return <main className="min-h-dvh min-w-0">{children}</main>;
  }

  return (
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <AppMobileTopBar />
        {/*
          min-w-0: flex アイテムの min-width デフォルト値（auto = 中身の最小コンテンツ幅）を
          解除する。無いと、横に長いテーブル（overflow-x-auto でラップ済みでも）の最小幅が
          main 自身に伝播しページ全体が横に広がってしまい、テーブル右側に余白が生まれる。
          isolate: ページ内の z-index（chat ヘッダー、分析テーブルの sticky セル等）を
          この中に閉じ込め、サイドバー・上部バー・Sheet より上に描かれないようにする。
        */}
        <main className="flex-1 min-w-0 isolate">{children}</main>
      </div>
    </div>
  );
}

function AppSidebar() {
  return (
    <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 sticky top-0 h-dvh z-30 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-14 items-center px-4 border-b border-sidebar-border">
        <Link href="/" className="text-lg font-bold">
          {BRAND_LABEL}
        </Link>
      </div>
      <AppNavList />
      <AppUserBlock />
    </aside>
  );
}

function AppMobileTopBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="lg:hidden sticky top-0 z-40 flex h-14 items-center gap-2 px-2 bg-background border-b border-border">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="size-11" aria-label="メニューを開く">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-60 max-w-[240px] sm:max-w-[240px] gap-0 bg-sidebar text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">メインメニュー</SheetTitle>
          <div className="flex h-14 items-center px-4 border-b border-sidebar-border">
            <Link href="/" onClick={() => setOpen(false)} className="text-lg font-bold">
              {BRAND_LABEL}
            </Link>
          </div>
          <AppNavList onNavigate={() => setOpen(false)} />
          <AppUserBlock />
        </SheetContent>
      </Sheet>
      <Link href="/" className="text-lg font-bold">
        {BRAND_LABEL}
      </Link>
    </header>
  );
}

function AppNavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const items = getVisibleNavItems(user?.role ?? null);

  return (
    <nav aria-label="メインメニュー" className="flex-1 overflow-y-auto px-2 py-3">
      <ul className="flex flex-col gap-1">
        {items.map(item => {
          const active = isNavItemActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                {...(onNavigate ? { onClick: onNavigate } : {})}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // lg 未満はドロワー内なので 44px のタッチターゲット（py-3）、lg 以上は py-2
                  'flex items-center gap-3 rounded-md px-3 py-3 lg:py-2 text-sm font-medium transition-colors',
                  'outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function AppUserBlock() {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  if (!user) return null;

  const displayName = user.fullName ?? user.email ?? 'ユーザー';

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const ok = await logout();
    if (!ok) {
      toast.error(ERROR_MESSAGES.AUTH.LOGOUT_FAILED);
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="border-t border-sidebar-border px-4 py-3 space-y-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-sidebar-foreground/70">{getRoleDisplayName(user.role)}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={handleLogout}
        disabled={isLoggingOut}
      >
        <LogOut className="h-4 w-4" />
        {isLoggingOut ? 'ログアウト中...' : 'ログアウト'}
      </Button>
    </div>
  );
}
