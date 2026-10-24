import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { isWordPressPublishBlocked } from '@/lib/wordpress-publish-dialog';

describe('isWordPressPublishBlocked', () => {
  it.each([
    ['完成形なし', 'open_chat'],
    ['送信中・作成結果不明など', 'close'],
    ['未連携', 'setup'],
    ['連携切れ', 'relink'],
  ])('%s（recovery: %s）では送信を止める', (_label, recovery) => {
    expect(isWordPressPublishBlocked({ info: '', recovery })).toBe(true);
  });

  it('WordPress 側で公開済みのお知らせを出したあとは送信を止める', () => {
    expect(isWordPressPublishBlocked({ info: ERROR_MESSAGES.WORDPRESS.PUBLISH_ALREADY_PUBLISHED, recovery: '' })).toBe(true);
  });

  it.each([
    ['エラーなし', ''],
    ['更新の再試行', 'retry'],
    ['削除済みで新規作成に戻す', 'resend'],
  ])('%s（recovery: %s）では送信できる', (_label, recovery) => {
    expect(isWordPressPublishBlocked({ info: '', recovery })).toBe(false);
  });
});
