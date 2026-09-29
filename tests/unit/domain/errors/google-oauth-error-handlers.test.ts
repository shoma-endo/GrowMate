import { describe, expect, it } from 'vitest';
import { isGoogleOAuthReauthError } from '@/domain/errors/google-oauth-error-handlers';

/**
 * googleTokenService.refreshAccessToken は 5xx/429 でも 400/401 でも同じ文言
 * （`Google OAuthトークンリフレッシュに失敗しました: Status {code}`）を投げるため、
 * ステータスコード優先で「本当の認証失効」と「一時的な失敗」を区別できているかを固定する。
 */
describe('isGoogleOAuthReauthError', () => {
  it.each([
    ['Status 400', new Error('Google OAuthトークンリフレッシュに失敗しました: Status 400')],
    ['Status 401', new Error('Google OAuthトークンリフレッシュに失敗しました: Status 401')],
    ['Status 403', new Error('Google OAuthトークンリフレッシュに失敗しました: Status 403')],
  ])('%s は再認証要と判定する', (_label, error) => {
    expect(isGoogleOAuthReauthError(error)).toBe(true);
  });

  it.each([
    ['Status 429', new Error('Google OAuthトークンリフレッシュに失敗しました: Status 429')],
    ['Status 500', new Error('Google OAuthトークンリフレッシュに失敗しました: Status 500')],
    ['Status 503', new Error('Google OAuthトークンリフレッシュに失敗しました: Status 503')],
  ])('%s は一時的失敗と判定する', (_label, error) => {
    expect(isGoogleOAuthReauthError(error)).toBe(false);
  });

  it.each([
    ['invalid_grant', new Error('invalid_grant: Token has been expired or revoked.')],
    ['insufficient permissions', new Error('Error: Insufficient Permissions')],
  ])('ステータスが無くても %s を含めば再認証要', (_label, error) => {
    expect(isGoogleOAuthReauthError(error)).toBe(true);
  });

  it('ステータスも既知の文字列も無いネットワーク例外は一時的失敗と判定する', () => {
    expect(isGoogleOAuthReauthError(new Error('fetch failed'))).toBe(false);
  });
});
