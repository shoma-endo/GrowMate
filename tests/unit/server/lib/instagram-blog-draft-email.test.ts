import { describe, expect, it } from 'vitest';
import { buildInstagramBlogDraftEmail, type InstagramBlogDraftEmailJob } from '@/server/lib/instagram-blog-draft-email';

const completedJob: InstagramBlogDraftEmailJob = {
  status: 'completed',
  sessionId: 'session-1',
  mainKeyword: '平飼い卵',
  caption: '投稿文',
  // 日本時間では 2022/9/9（UTC のままだと 9/8 になる）
  postedAt: '2022-09-08T23:27:45Z',
};

describe('Instagram blog draft notification email', () => {
  it('件名は常に同じで、完了した記事は主軸kw と投稿日をチャットへの絶対リンクで並べる', () => {
    const email = buildInstagramBlogDraftEmail('https://growmate.example', [completedJob]);
    expect(email.subject).toBe('【GrowMate】ブログ記事生成完了');
    expect(email.html).toContain('ブログ記事の生成が終わりました（完了 1件）');
    expect(email.html).not.toContain('失敗');
    expect(email.html).toContain(
      '<a href="https://growmate.example/chat?session=session-1&amp;initialStep=step7">平飼い卵</a>（2022/9/9 投稿）'
    );
    expect(email.html).toContain('href="https://growmate.example/analytics?tab=instagram"');
  });

  it('失敗した記事は件数・［続きを作成］の案内と、記事名に「失敗」を付けて並べる', () => {
    const email = buildInstagramBlogDraftEmail('https://growmate.example', [
      completedJob,
      { status: 'failed', sessionId: null, mainKeyword: null, caption: '<script>投稿文</script>', postedAt: null },
    ]);
    expect(email.html).toContain('完了 1件・失敗 1件');
    expect(email.html).toContain('［続きを作成］で続きから作れます');
    expect(email.html).toContain('&lt;script&gt;投稿文&lt;/script&gt;: 失敗');
    expect(email.html).not.toContain('<script>');
  });
});
