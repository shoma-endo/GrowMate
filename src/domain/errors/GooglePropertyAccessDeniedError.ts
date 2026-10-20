/**
 * GSC Search Analytics / GA4 Data API が、Google アカウントにプロパティの権限が無いことを理由に 403 を返したときに投げる。
 * API の無効化や割り当て超過の 403 は含めない（プロパティの選び直しや再連携では直らないため）。
 */
export class GooglePropertyAccessDeniedError extends Error {
  /** 拒否されたプロパティ（GSC は property_uri、GA4 は ga4_property_id と同じ値） */
  readonly property: string;

  constructor(message: string, property: string) {
    super(message);
    this.property = property;
    this.name = 'GooglePropertyAccessDeniedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type GoogleApiErrorBody = {
  error?: {
    status?: string;
    errors?: Array<{ reason?: string }>;
    details?: Array<{ reason?: string }>;
  };
};

function parseGoogleApiErrorBody(text: string): GoogleApiErrorBody['error'] {
  try {
    return (JSON.parse(text) as GoogleApiErrorBody).error;
  } catch {
    return undefined;
  }
}

/** Search Console API（v3 形式）は errors[].reason で理由を返す。権限が無いときは forbidden */
export function isGscPropertyAccessDenied(status: number, text: string): boolean {
  if (status !== 403) return false;
  return parseGoogleApiErrorBody(text)?.errors?.some(e => e.reason === 'forbidden') ?? false;
}

/** 同じ PERMISSION_DENIED でも、プロパティの選び直しや再連携では直らない理由 */
const GA4_NON_PROPERTY_DENIED_REASONS = new Set(['SERVICE_DISABLED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

/** GA4 Data API は status: PERMISSION_DENIED を返す。API 無効化とスコープ不足は details の reason で除く */
export function isGa4PropertyAccessDenied(status: number, text: string): boolean {
  if (status !== 403) return false;
  const error = parseGoogleApiErrorBody(text);
  return (
    error?.status === 'PERMISSION_DENIED' &&
    !(error.details ?? []).some(d => d.reason !== undefined && GA4_NON_PROPERTY_DENIED_REASONS.has(d.reason))
  );
}
