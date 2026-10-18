import { describe, expect, it } from 'vitest';

import { MODEL_CONFIGS } from '@/lib/constants';

// ブログ作成は書き出し前（step1〜5）を Sonnet 5.5、書き出し以降を Haiku 5.5 で試験運用している。
// Sonnet 5.5 は thinking: disabled を 400 で拒否するため、思考オフは between_tools で指定する。
describe('ブログ作成のモデル設定', () => {
  it.each(['blog_creation_step1', 'blog_creation_step2', 'blog_creation_step3', 'blog_creation_step4', 'blog_creation_step5'])(
    '%s は Sonnet 5.5・between_tools',
    key => {
      expect(MODEL_CONFIGS[key]).toMatchObject({
        provider: 'anthropic',
        actualModel: 'claude-sonnet-5-5',
        thinking: { type: 'between_tools' },
      });
    }
  );

  it.each(['blog_creation_step6', 'blog_creation_step7', 'blog_creation_step7_heading', 'blog_title_meta_generation'])(
    '%s は Haiku 5.5・思考オフ',
    key => {
      expect(MODEL_CONFIGS[key]).toMatchObject({
        provider: 'anthropic',
        actualModel: 'claude-haiku-5-5',
        thinking: { type: 'disabled' },
      });
    }
  );

  it('between_tools は Sonnet 5.5 の設定にだけ使う（ほかのモデルでは 400）', () => {
    for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
      if (config.thinking?.type === 'between_tools') {
        expect(config.actualModel, key).toBe('claude-sonnet-5-5');
      }
    }
  });

  it('Sonnet 5.5・Haiku 5.5 の設定は temperature / top_p を持たない（両モデルとも既定以外は 400）', () => {
    const keys = Object.keys(MODEL_CONFIGS).filter(key =>
      ['claude-sonnet-5-5', 'claude-haiku-5-5'].includes(MODEL_CONFIGS[key]!.actualModel)
    );
    expect(keys.length).toBe(9);
    for (const key of keys) {
      expect(MODEL_CONFIGS[key]!.temperature).toBeUndefined();
      expect(MODEL_CONFIGS[key]!.top_p).toBeUndefined();
    }
  });
});
