import { describe, expect, it } from 'vitest';
import { buildInstagramBlogDraftEmail } from '@/server/lib/instagram-blog-draft-email';

describe('Instagram blog draft notification email', () => {
  it('全件完了は件数付きの件名とチャットへの絶対リンクを作る', () => {
    const email = buildInstagramBlogDraftEmail('https://growmate.example', [{
      status: 'completed',
      errorCode: null,
      sessionId: 'session-1',
      mainKeyword: '主キーワード',
      caption: '投稿文',
    }]);
    expect(email.subject).toBe('【GrowMate】ブログ記事ができました（1件）');
    expect(email.html).toContain('主キーワード: できました');
    expect(email.html).toContain('https://growmate.example/chat?session=session-1&amp;initialStep=step7');
  });

  it('失敗と途切れをまとめ、Instagram タブへのリンクを出す', () => {
    const email = buildInstagramBlogDraftEmail('https://growmate.example', [
      { status: 'completed', errorCode: null, sessionId: 'session-1', mainKeyword: '完了', caption: '' },
      { status: 'failed', errorCode: 'MAX_TOKENS', sessionId: 'session-2', mainKeyword: null, caption: '<script>投稿文</script>' },
    ]);
    expect(email.subject).toBe('【GrowMate】ブログ記事の作成が終わりました（完了 1件・止まった 1件）');
    expect(email.html).toContain('AI の出力が途中で切れました');
    expect(email.html).toContain('https://growmate.example/analytics?tab=instagram');
    expect(email.html).not.toContain('<script>');
  });
});
