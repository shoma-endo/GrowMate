import { describe, expect, it } from 'vitest';
import { isClientPublicPath } from '@/lib/public-paths';

describe('isClientPublicPath', () => {
  it.each(['/home', '/privacy', '/terms', '/login', '/review-login'])(
    '%s を公開パスとして扱う',
    path => {
      // '/review-login' が漏れると、セッションを持たない Meta 審査員が AuthProvider の
      // マウント直後に /login へリダイレクトされ、審査が進まない。
      // '/privacy' と '/terms' は審査側が匿名で開くため同様に必須。
      expect(isClientPublicPath(path)).toBe(true);
    }
  );

  it.each(['/', '/chat', '/unauthorized', '/setup/instagram'])(
    '%s は公開パスとして扱わない',
    path => {
      // '/' と '/unauthorized' は proxy.ts では公開だが、クライアント側では認証必須のまま
      // にする必要がある。ここを「揃える」と未ログイン訪問者が空の '/' に留まる。
      expect(isClientPublicPath(path)).toBe(false);
    }
  );

  it('スラッシュ区切りの配下も公開パスとして扱う', () => {
    expect(isClientPublicPath('/privacy/2024')).toBe(true);
  });

  it('前方一致だけで一致する別パスを公開扱いしない', () => {
    expect(isClientPublicPath('/loginx')).toBe(false);
    expect(isClientPublicPath('/review-login-admin')).toBe(false);
  });

  it('pathname が null なら公開パスとして扱わない', () => {
    expect(isClientPublicPath(null)).toBe(false);
  });
});
