import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ga4Service } from '@/server/services/ga4Service';
import { GooglePropertyAccessDeniedError } from '@/domain/errors/GooglePropertyAccessDeniedError';

describe('Ga4Service.runReport のエラー（auto-daily-imports-spec FR-011）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('権限不足の 403 は権限切れの例外にし、文言は従来どおり', async () => {
    const body = '{"error":{"code":403,"message":"User does not have sufficient permissions for this property.","status":"PERMISSION_DENIED"}}';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 403 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const error = await new Ga4Service().runReport('token', 'properties/1', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GooglePropertyAccessDeniedError);
    expect((error as Error).message).toBe(`GA4レポート取得に失敗しました: 403 ${body}`);
  });

  it.each([
    ['503', new Response('unavailable', { status: 503 })],
    [
      'API 無効化の 403',
      new Response(
        '{"error":{"code":403,"status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"SERVICE_DISABLED"}]}}',
        { status: 403 }
      ),
    ],
  ])('%s は通常の Error のまま', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const error = await new Ga4Service().runReport('token', 'properties/1', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GooglePropertyAccessDeniedError);
  });
});
