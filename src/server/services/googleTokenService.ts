export interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresIn?: number | undefined;
  scope?: string[] | undefined;
  idToken?: string | undefined;
  tokenType?: string | undefined;
}

export interface GoogleUserInfoResponse {
  email?: string;
  email_verified?: boolean;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USER_INFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const DEFAULT_TIMEOUT = 10000; // 10 seconds

/**
 * アクセストークンの有効期限マージン（1分）
 * トークンがこの時間以内に期限切れになる場合はリフレッシュする
 */
export const ACCESS_TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

/**
 * アクセストークンがまだ再利用可能かどうかを判定する
 */
export function hasReusableAccessToken(
  credential: { accessToken?: string | null; accessTokenExpiresAt?: string | null }
): credential is { accessToken: string; accessTokenExpiresAt: string } {
  if (!credential.accessToken || !credential.accessTokenExpiresAt) {
    return false;
  }
  const expiresAtMs = new Date(credential.accessTokenExpiresAt).getTime();
  return expiresAtMs - Date.now() > ACCESS_TOKEN_SAFETY_MARGIN_MS;
}

export interface EnsureAccessTokenDeps {
  refreshAccessToken: (refreshToken: string) => Promise<GoogleOAuthTokens>;
  persistToken: (accessToken: string, expiresAt: string | null, scope: string[] | null) => Promise<void>;
}

/**
 * アクセストークンが有効ならそのまま返し、期限切れならリフレッシュ + DB永続化して返す
 */
export async function ensureValidAccessToken(
  credential: { refreshToken: string; accessToken?: string | null; accessTokenExpiresAt?: string | null },
  deps: EnsureAccessTokenDeps
): Promise<string> {
  if (hasReusableAccessToken(credential)) {
    return credential.accessToken;
  }
  const refreshed = await deps.refreshAccessToken(credential.refreshToken);
  const expiresAt = refreshed.expiresIn
    ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
    : null;
  await deps.persistToken(refreshed.accessToken, expiresAt, refreshed.scope ?? null);
  return refreshed.accessToken;
}

export class GoogleTokenService {
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor() {
    this.clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  }

  private ensureCredentials() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Google OAuthクライアント情報が設定されていません');
    }
  }

  private parseTokenResponse(body: Record<string, unknown>): GoogleOAuthTokens {
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    if (!accessToken) {
      throw new Error('Google OAuthレスポンスにaccess_tokenが含まれていません');
    }
    const refreshToken =
      typeof body.refresh_token === 'string' && body.refresh_token.length > 0
        ? body.refresh_token
        : undefined;
    const expiresIn =
      typeof body.expires_in === 'number'
        ? body.expires_in
        : typeof body.expires_in === 'string'
          ? Number(body.expires_in)
          : undefined;
    const scope =
      typeof body.scope === 'string'
        ? body.scope
            .split(' ')
            .map(s => s.trim())
            .filter(Boolean)
        : undefined;
    const idToken = typeof body.id_token === 'string' ? body.id_token : undefined;
    const tokenType = typeof body.token_type === 'string' ? body.token_type : undefined;

    return {
      accessToken,
      refreshToken,
      expiresIn,
      scope,
      idToken,
      tokenType,
    };
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleOAuthTokens> {
    this.ensureCredentials();

    if (!code) {
      throw new Error('認証コード(code)が指定されていません');
    }
    if (!redirectUri) {
      throw new Error('リダイレクトURI(redirectUri)が指定されていません');
    }

    const params = new URLSearchParams({
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('Google OAuthトークン交換エラー:', {
          status: response.status,
          body: text,
        });
        throw new Error(`Google OAuthトークン交換に失敗しました: Status ${response.status}`);
      }

      const body = (await response.json()) as Record<string, unknown>;
      return this.parseTokenResponse(body);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleOAuthTokens> {
    this.ensureCredentials();

    if (!refreshToken) {
      throw new Error('リフレッシュトークン(refreshToken)が指定されていません');
    }

    const params = new URLSearchParams({
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('Google OAuthトークンリフレッシュエラー:', {
          status: response.status,
          body: text,
        });
        throw new Error(`Google OAuthトークンリフレッシュに失敗しました: Status ${response.status}`);
      }

      const body = (await response.json()) as Record<string, unknown>;
      return this.parseTokenResponse(body);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchUserInfo(accessToken: string): Promise<GoogleUserInfoResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(USER_INFO_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Googleユーザー情報の取得に失敗しました: ${response.status} ${text}`);
      }

      return (await response.json()) as GoogleUserInfoResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
