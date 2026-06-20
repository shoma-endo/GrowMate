export type GoogleAdsDashboardTab = 'metrics' | 'settings';

export function resolveGoogleAdsDashboardTab(value: string | null): GoogleAdsDashboardTab {
  return value === 'settings' ? 'settings' : 'metrics';
}

export function buildGoogleAdsDashboardTabSearchParams(
  currentParams: string,
  tab: GoogleAdsDashboardTab
): string {
  const nextParams = new URLSearchParams(currentParams);
  nextParams.set('tab', tab);
  return nextParams.toString();
}
