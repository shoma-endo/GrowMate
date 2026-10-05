import { describe, expect, it } from 'vitest';
import { buildInstagramBlogDraftEmail } from '@/server/lib/instagram-blog-draft-email';

describe('Instagram blog draft notification email', () => {
  it('件名は常に同じで、本文は件数と Instagram タブへの絶対リンク', () => {
    const email = buildInstagramBlogDraftEmail('https://growmate.example', { completed: 2, failed: 0 });
    expect(email.subject).toBe('【GrowMate】ブログ記事生成完了');
    expect(email.html).toContain('ブログ記事の生成が終わりました（完了 2件）');
    expect(email.html).not.toContain('失敗');
    expect(email.html).toContain('href="https://growmate.example/analytics?tab=instagram"');
    expect(email.html).not.toContain('/chat?session=');
  });

  it('失敗があれば件数と［続きを作成］で続きから作れることを書く', () => {
    const email = buildInstagramBlogDraftEmail('https://growmate.example', { completed: 1, failed: 2 });
    expect(email.subject).toBe('【GrowMate】ブログ記事生成完了');
    expect(email.html).toContain('完了 1件・失敗 2件');
    expect(email.html).toContain('［続きを作成］で続きから作れます');
  });
});
