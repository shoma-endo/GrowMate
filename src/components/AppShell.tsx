'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { useAuth } from '@/components/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getVisibleNavGroups, isNavItemActive } from '@/lib/app-nav';
import { APP_SHELL_STORAGE_KEYS } from '@/lib/constants';
import { getRoleDisplayName } from '@/authUtils';
import { cn } from '@/lib/utils';

/**
 * アプリ共通シェル。lg（1024px）以上は左サイドバー（240px ⇔ 64px のアイコンレールに折りたたみ可）、
 * 未満は上部バー＋左ドロワー。出し分けは CSS ブレークポイントで行う
 * （useMobile は初回 width 0 で描画が跳ねるため使わない）。
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

/**
 * 折りたたみ状態。AuthProvider がロード完了まで children を描画しないので、
 * 初期値で localStorage を読んでも hydration 不一致にならない。
 */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(APP_SHELL_STORAGE_KEYS.SIDEBAR_COLLAPSED) === 'true';
  });

  useEffect(() => {
    window.localStorage.setItem(APP_SHELL_STORAGE_KEYS.SIDEBAR_COLLAPSED, String(collapsed));
  }, [collapsed]);

  return [collapsed, () => setCollapsed(value => !value)];
}

function BrandLink({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      href="/"
      {...(onClick ? { onClick } : {})}
      className="truncate rounded-md text-lg font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
    >
      {BRAND_LABEL}
    </Link>
  );
}

function AppSidebar() {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const toggleLabel = collapsed ? 'メニューを広げる' : 'メニューを折りたたむ';
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'hidden lg:flex lg:flex-col shrink-0 sticky top-0 h-dvh z-30 bg-sidebar text-sidebar-foreground border-r border-sidebar-border',
        'transition-[width] duration-200 ease-in-out motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* 折りたたみ時はブランド名を出さずトグルだけを中央に置く */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-sidebar-border',
          collapsed ? 'justify-center' : 'justify-between px-3'
        )}
      >
        {!collapsed && <BrandLink />}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <ToggleIcon className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
      <AppNavList collapsed={collapsed} />
      <AppUserBlock collapsed={collapsed} />
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
          <div className="flex h-14 shrink-0 items-center px-3 border-b border-sidebar-border">
            <BrandLink onClick={() => setOpen(false)} />
          </div>
          <AppNavList onNavigate={() => setOpen(false)} />
          <AppUserBlock />
        </SheetContent>
      </Sheet>
      <BrandLink />
    </header>
  );
}

interface AppNavListProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

function AppNavList({ collapsed = false, onNavigate }: AppNavListProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const groups = getVisibleNavGroups(user?.role ?? null);

  return (
    <nav
      aria-label="メインメニュー"
      className={cn('flex-1 overflow-y-auto overflow-x-hidden py-2', collapsed ? 'px-2' : 'px-3')}
    >
      {groups.map(({ group, items }, groupIndex) => (
        <div
          key={group.id}
          className={cn(
            groupIndex > 0 && (collapsed ? 'mt-2 border-t border-sidebar-border pt-2' : 'mt-4')
          )}
        >
          {!collapsed && (
            <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
              {group.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {items.map(item => {
              const active = isNavItemActive(pathname, item);
              const Icon = item.icon;
              const link = (
                <Link
                  href={item.href}
                  {...(onNavigate ? { onClick: onNavigate } : {})}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    // lg 未満はドロワー内なので 44px のタッチターゲット（py-3）、lg 以上は py-2
                    'relative flex items-center gap-3 rounded-md text-sm transition-colors',
                    'outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50',
                    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-3 lg:py-2',
                    active
                      ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                      : 'font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    // アクティブ項目の左アクセントバー（折りたたみ時はレール外側に出る）
                    active &&
                      !collapsed &&
                      'before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-sidebar-primary'
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AppUserBlock({ collapsed = false }: { collapsed?: boolean }) {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  if (!user) return null;

  const displayName = user.fullName ?? user.email ?? 'ユーザー';
  const roleName = getRoleDisplayName(user.role);
  const initial = displayName.trim().charAt(0).toUpperCase();
  const logoutLabel = isLoggingOut ? 'ログアウト中...' : 'ログアウト';

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const ok = await logout();
    if (!ok) {
      toast.error(ERROR_MESSAGES.AUTH.LOGOUT_FAILED);
      setIsLoggingOut(false);
    }
  };

  const avatar = (
    <Avatar className="size-8 bg-sidebar-accent text-sidebar-accent-foreground">
      {user.linePictureUrl ? (
        <Image src={user.linePictureUrl} alt="" width={32} height={32} />
      ) : (
        <span className="flex size-full items-center justify-center text-xs font-semibold" aria-hidden>
          {initial}
        </span>
      )}
    </Avatar>
  );

  const logoutButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleLogout}
      disabled={isLoggingOut}
      aria-label={logoutLabel}
      className="shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <LogOut className="h-4 w-4" />
    </Button>
  );

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-sidebar-border py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex size-9 items-center justify-center" tabIndex={0}>
              {avatar}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {displayName}（{roleName}）
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>{logoutButton}</TooltipTrigger>
          <TooltipContent side="right">{logoutLabel}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-sidebar-border px-3 py-3">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-sidebar-foreground/70">{roleName}</p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>{logoutButton}</TooltipTrigger>
        <TooltipContent side="top">{logoutLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
