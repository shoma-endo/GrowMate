import { describe, expect, it } from 'vitest';
import {
  isInstagramPreConversionMediaError,
  isInstagramReauthError,
  isInstagramRevokedTokenError,
} from '@/domain/errors/instagram-error-handlers';

// parseJsonResponse が実際に投げる形。レスポンス本文をメッセージに含めて throw する。
function graphError(body: string): Error {
  return new Error(`Instagram API error: HTTP 400 ${body}`);
}

// 2026-08-02 に manbou536 の転換前投稿で実測した本文（HTTP 400）。
// type は OAuthException ではなく IGApiException である点が重要で、
// これにより isInstagramReauthError と衝突しない。
const PRE_CONVERSION_BODY =
  '{"error":{"message":"このメディアは、ユーザーのアカウントが個人アカウントからビジネスアカウントに最後に変換された時点より前に投稿されました。","type":"IGApiException","code":100,"error_subcode":2108006,"fbtrace_id":"AbCdEf"}}';

describe('isInstagramPreConversionMediaError', () => {
  it('error_subcode 2108006 を含むエラーを検出する', () => {
    expect(isInstagramPreConversionMediaError(graphError(PRE_CONVERSION_BODY))).toBe(true);
  });

  it('スペース入りの表記でも検出する', () => {
    expect(isInstagramPreConversionMediaError(new Error('error_subcode: 2108006'))).toBe(true);
  });

  it('別の subcode は検出しない', () => {
    expect(
      isInstagramPreConversionMediaError(graphError('{"error":{"code":100,"error_subcode":33}}'))
    ).toBe(false);
  });

  it('再認証エラーを転換前エラーとして誤検出しない', () => {
    const reauth = graphError('{"error":{"type":"OAuthException","code":190}}');
    expect(isInstagramPreConversionMediaError(reauth)).toBe(false);
    expect(isInstagramReauthError(reauth)).toBe(true);
  });

  it('転換前エラーを再認証エラーとして誤検出しない', () => {
    // ここが true になると「Instagramの認証が期限切れです。再連携してください」が出て、
    // 何度再連携しても直らない無意味な導線になる。実測では type=IGApiException なので
    // isInstagramReauthError の oauthexception 判定には掛からない。
    const preConversion = graphError(PRE_CONVERSION_BODY);
    expect(isInstagramReauthError(preConversion)).toBe(false);
    expect(isInstagramPreConversionMediaError(preConversion)).toBe(true);
  });

  it('Error 以外は false を返す', () => {
    expect(isInstagramPreConversionMediaError('error_subcode":2108006')).toBe(false);
    expect(isInstagramPreConversionMediaError(null)).toBe(false);
    expect(isInstagramPreConversionMediaError(undefined)).toBe(false);
  });
});

describe('isInstagramRevokedTokenError', () => {
  // Meta はレート制限や権限エラーにも "type":"OAuthException" を付ける。
  // 失効と断定できるのは code 190 系だけ。
  const RATE_LIMIT = graphError(
    '{"error":{"message":"Application request limit reached","type":"OAuthException","code":4}}'
  );
  const USER_RATE_LIMIT = graphError(
    '{"error":{"message":"User request limit reached","type":"OAuthException","code":17}}'
  );
  const REVOKED = graphError(
    '{"error":{"message":"Error validating access token: The user has not authorized application.","type":"OAuthException","code":190,"error_subcode":458}}'
  );

  it('code 190 の失効エラーを検出する', () => {
    expect(isInstagramRevokedTokenError(REVOKED)).toBe(true);
  });

  it.each([
    ['アプリ単位のレート制限 (code 4)', RATE_LIMIT],
    ['ユーザー単位のレート制限 (code 17)', USER_RATE_LIMIT],
  ])('%s を失効として扱わない', (_label, error) => {
    // ここが true になると、有効なトークンの期限を過去へ倒してしまい、
    // resolveInstagramTokenAction がリフレッシュを試みなくなって恒久的に死ぬ。
    expect(isInstagramRevokedTokenError(error)).toBe(false);
    // 一方、表示を再認証へ倒す広い判定には引っかかる（次回読み込みで自然に回復する）
    expect(isInstagramReauthError(error)).toBe(true);
  });

  it('転換前エラーを失効として扱わない', () => {
    expect(isInstagramRevokedTokenError(graphError(PRE_CONVERSION_BODY))).toBe(false);
  });

  it('Error 以外は false を返す', () => {
    expect(isInstagramRevokedTokenError('code":190')).toBe(false);
    expect(isInstagramRevokedTokenError(null)).toBe(false);
  });
});
