'use client';

import { useOptimistic, useTransition, type ReactNode } from 'react';
import { BarChart3, Mail } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  buildGoogleAdsDashboardTabSearchParams,
  resolveGoogleAdsDashboardTab,
  type GoogleAdsDashboardTab,
} from './googleAdsDashboardTabs.utils';

interface GoogleAdsDashboardTabsProps {
  metricsContent: ReactNode;
  settingsContent: ReactNode;
}

export function GoogleAdsDashboardTabs({
  metricsContent,
  settingsContent,
}: GoogleAdsDashboardTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = resolveGoogleAdsDashboardTab(searchParams?.get('tab') ?? null);
  const [optimisticTab, setOptimisticTab] = useOptimistic<GoogleAdsDashboardTab, GoogleAdsDashboardTab>(
    urlTab,
    (_currentTab, nextTab) => nextTab
  );
  const [, startTabTransition] = useTransition();

  const handleTabChange = (value: string) => {
    const nextTab = resolveGoogleAdsDashboardTab(value);
    const nextSearch = buildGoogleAdsDashboardTabSearchParams(
      searchParams?.toString() ?? '',
      nextTab
    );
    const nextUrl = `${window.location.pathname}?${nextSearch}`;

    startTabTransition(() => {
      setOptimisticTab(nextTab);
      router.replace(nextUrl, { scroll: false });
    });
  };

  return (
    <Tabs value={optimisticTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid h-12 w-full grid-cols-2 sm:w-fit">
        <TabsTrigger value="metrics" className="gap-2 px-4">
          <BarChart3 className="h-4 w-4" />
          数値指標
        </TabsTrigger>
        <TabsTrigger value="settings" className="gap-2 px-4">
          <Mail className="h-4 w-4" />
          メール送信設定
        </TabsTrigger>
      </TabsList>

      <TabsContent value="metrics" className="mt-6 space-y-6">
        {metricsContent}
      </TabsContent>

      <TabsContent value="settings" className="mt-6">
        {settingsContent}
      </TabsContent>
    </Tabs>
  );
}
