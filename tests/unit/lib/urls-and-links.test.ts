/**
 * URL と紐付けの判定
 *
 * 公開パスの判定（`public-paths`）、記事詳細URLの組み立て（`routes`）、
 * 記事が WordPress に紐づいているかの判定（`wordpress-link`）。
 *
 * 元は1モジュール1ファイルに分かれていた。30行未満のファイルが並んで
 * 目的のものを絞れなくなっていたため、役割の単位でまとめている。
 * どのモジュールの検査かは外側の describe が示す。
 * 各モジュールのフック（useFakeTimers 等）も外側の describe に閉じる。
 */
import { describe, expect, it } from 'vitest';
import { isClientPublicPath } from '@/lib/public-paths';
import { annotationDetailPath } from '@/lib/routes';
import { isWordPressLinked } from '@/lib/wordpress-link';

describe('@/lib/public-paths', () => {
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
});

describe('@/lib/routes', () => {
  describe('annotationDetailPath', () => {
    it('動的セグメントとして組み立てる', () => {
      expect(annotationDetailPath('0e9e2d1c-4b6a-4f2e-9a1b-3c5d7e9f1a2b')).toBe(
        '/analytics/0e9e2d1c-4b6a-4f2e-9a1b-3c5d7e9f1a2b'
      );
    });

    it('クエリ文字列形式を生成しない', () => {
      // `/analytics?annotationId=<id>` は annotationId が解釈されず
      // コンテンツ一覧へ落ちる（実際に GA4 ダッシュボードで発生した不具合）
      const path = annotationDetailPath('abc');
      expect(path).not.toContain('?');
      expect(path).not.toContain('annotationId=');
    });

    it('パスに使えない文字をエスケープする', () => {
      expect(annotationDetailPath('a/b?c#d')).toBe('/analytics/a%2Fb%3Fc%23d');
    });

    it('空文字でも一覧のパスにならない', () => {
      // `/analytics` そのものになると一覧へ遷移してしまうため、末尾スラッシュを残す
      expect(annotationDetailPath('')).toBe('/analytics/');
    });
  });
});

describe('@/lib/wordpress-link', () => {
  describe('isWordPressLinked', () => {
    it('保存済みURLがあれば連携済みと判定する', () => {
      expect(isWordPressLinked({ canonical_url: 'https://example.com/post/' })).toBe(true);
    });

    it('有効な投稿IDがあれば連携済みと判定する', () => {
      expect(isWordPressLinked({ canonical_url: null, wp_post_id: 42 })).toBe(true);
    });

    it('URLと投稿IDが解除された場合は未連携と判定する', () => {
      expect(isWordPressLinked({ canonical_url: null, wp_post_id: null })).toBe(false);
    });
  });
});
