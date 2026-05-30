'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Mail } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type GoogleAdsDashboardTab = 'metrics' | 'settings';

interface GoogleAdsDashboardTabsProps {
  metricsContent: ReactNode;
  settingsContent: ReactNode;
}

function resolveTab(value: string | null): GoogleAdsDashboardTab {
  return value === 'settings' ? 'settings' : 'metrics';
}

export function GoogleAdsDashboardTabs({
  metricsContent,
  settingsContent,
}: GoogleAdsDashboardTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<GoogleAdsDashboardTab>(() =>
    resolveTab(searchParams?.get('tab') ?? null)
  );

  useEffect(() => {
    setActiveTab(resolveTab(searchParams?.get('tab') ?? null));
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    const nextTab = resolveTab(value);
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
    nextParams.set('tab', nextTab);

    setActiveTab(nextTab);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
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
