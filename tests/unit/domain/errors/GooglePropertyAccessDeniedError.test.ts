import { describe, expect, it } from 'vitest';
import {
  isGa4PropertyAccessDenied,
  isGscPropertyAccessDenied,
} from '@/domain/errors/GooglePropertyAccessDeniedError';

const gscBody = (reason: string) =>
  JSON.stringify({ error: { code: 403, message: 'm', errors: [{ message: 'm', domain: 'global', reason }] } });
const ga4Body = (details: Array<{ reason: string }> = []) =>
  JSON.stringify({ error: { code: 403, message: 'm', status: 'PERMISSION_DENIED', details } });

describe('プロパティの権限切れの判定（auto-daily-imports-spec FR-011）', () => {
  it('GSC は 403 かつ reason が forbidden のときだけ権限切れ', () => {
    expect(isGscPropertyAccessDenied(403, gscBody('forbidden'))).toBe(true);
    expect(isGscPropertyAccessDenied(403, gscBody('rateLimitExceeded'))).toBe(false);
    expect(isGscPropertyAccessDenied(403, gscBody('accessNotConfigured'))).toBe(false);
    expect(isGscPropertyAccessDenied(403, gscBody('insufficientPermissions'))).toBe(false);
    expect(isGscPropertyAccessDenied(500, gscBody('forbidden'))).toBe(false);
    expect(isGscPropertyAccessDenied(403, 'not json')).toBe(false);
  });

  it('GA4 は 403 PERMISSION_DENIED で理由（ErrorInfo）が付いていないときだけ権限切れ', () => {
    expect(isGa4PropertyAccessDenied(403, ga4Body())).toBe(true);
    expect(isGa4PropertyAccessDenied(403, ga4Body([{ reason: 'SERVICE_DISABLED' }]))).toBe(false);
    expect(isGa4PropertyAccessDenied(403, ga4Body([{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }]))).toBe(false);
    expect(isGa4PropertyAccessDenied(403, JSON.stringify({ error: { code: 403, message: 'm' } }))).toBe(false);
    expect(isGa4PropertyAccessDenied(429, ga4Body())).toBe(false);
    expect(isGa4PropertyAccessDenied(403, 'not json')).toBe(false);
  });
});
