import { describe, expect, it } from 'vitest';
import { buildInstagramBlogDraftEmail } from '@/server/lib/instagram-blog-draft-email';

describe('Instagram blog draft notification email', () => {
  it('件名は常に同じで、本文は Instagram タブへの絶対リンクだけ', () => {
    const email = buildInstagramBlogDraftEmail('https://growmate.example');
    expect(email.subject).toBe('【GrowMate】ブログ記事生成完了');
    expect(email.html).toContain('ブログ記事の生成が終わりました');
    expect(email.html).toContain('href="https://growmate.example/analytics?tab=instagram"');
    expect(email.html).not.toContain('/chat?session=');
  });
});
