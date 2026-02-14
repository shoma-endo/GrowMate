import type { Ga4KeyEvent, Ga4PropertySummary } from '@/types/ga4';

interface Ga4AccountSummaryResponse {
  accountSummaries?: Array<{
    name?: string;
    displayName?: string;
    propertySummaries?: Array<{
      property?: string;
      displayName?: string;
    }>;
  }>;
}

interface Ga4KeyEventsResponse {
  keyEvents?: Array<{
    name?: string;
    eventName?: string;
  }>;
}

interface Ga4RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  rowCount?: number;
  metadata?: {
    dataLossFromOtherRow?: boolean;
    subjectToThresholding?: boolean;
    samplingMetadatas?: unknown[];
  };
}

const GA4_ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const GA4_DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

export class Ga4Service {
  async listProperties(accessToken: string): Promise<Ga4PropertySummary[]> {
    const response = await fetch(`${GA4_ADMIN_BASE}/accountSummaries`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GA4プロパティ一覧の取得に失敗しました: ${response.status} ${text}`);
    }

    const body = (await response.json()) as Ga4AccountSummaryResponse;
    const summaries = Array.isArray(body.accountSummaries) ? body.accountSummaries : [];
    const results: Ga4PropertySummary[] = [];

    for (const account of summaries) {
      const accountId = account.name ?? null;
      const accountName = account.displayName ?? null;
      const props = Array.isArray(account.propertySummaries) ? account.propertySummaries : [];
      for (const prop of props) {
        const propertyId = prop.property;
        const displayName = prop.displayName;
        if (!propertyId || !displayName) continue;
        results.push({
          propertyId,
          displayName,
          accountId,
          accountName,
        });
      }
    }

    return results;
  }

  async listKeyEvents(accessToken: string, propertyId: string): Promise<Ga4KeyEvent[]> {
    const normalizedProperty = normalizePropertyId(propertyId);
    const response = await fetch(`${GA4_ADMIN_BASE}/${normalizedProperty}/keyEvents`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GA4キーイベント一覧の取得に失敗しました: ${response.status} ${text}`);
    }

    const body = (await response.json()) as Ga4KeyEventsResponse;
    const events = Array.isArray(body.keyEvents) ? body.keyEvents : [];

    return events
      .map(event => ({
        name: event.name ?? '',
        eventName: event.eventName ?? '',
      }))
      .filter(event => event.eventName.length > 0);
  }

  async runReport(
    accessToken: string,
    propertyId: string,
    body: Record<string, unknown>
  ): Promise<Ga4RunReportResponse> {
    const normalizedProperty = normalizePropertyId(propertyId);
    const response = await fetch(`${GA4_DATA_BASE}/${normalizedProperty}:runReport`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GA4レポート取得に失敗しました: ${response.status} ${text}`);
    }

    return (await response.json()) as Ga4RunReportResponse;
  }
}

function normalizePropertyId(propertyId: string): string {
  if (propertyId.startsWith('properties/')) {
    return propertyId;
  }
  return `properties/${propertyId}`;
}
