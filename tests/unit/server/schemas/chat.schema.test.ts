import { describe, expect, it } from 'vitest';

import { continueChatSchema, startChatSchema } from '@/server/schemas/chat.schema';

describe('startChatSchema', () => {
  const validInput = {
    userMessage: 'こんにちは',
    model: 'model',
  };

  it('必須フィールドを受理する', () => {
    expect(startChatSchema.safeParse(validInput).success).toBe(true);
  });

  it.each(['userMessage', 'model'] as const)('必須フィールド %s の欠落を拒否する', key => {
    const { [key]: _omitted, ...input } = validInput;
    expect(startChatSchema.safeParse(input).success).toBe(false);
  });
});

describe('continueChatSchema', () => {
  const validInput = {
    sessionId: 'session-id',
    messages: [{ role: 'user', content: 'こんにちは' }],
    userMessage: '続けてください',
    model: 'model',
  };

  it('定義済みroleを受理する', () => {
    expect(continueChatSchema.safeParse(validInput).success).toBe(true);
  });

  it('不正roleを拒否する', () => {
    expect(
      continueChatSchema.safeParse({
        ...validInput,
        messages: [{ role: 'developer', content: '指示' }],
      }).success
    ).toBe(false);
  });

  it('messages空配列を受理する現行挙動を固定する', () => {
    expect(
      continueChatSchema.safeParse({
        ...validInput,
        messages: [],
      }).success
    ).toBe(true);
  });

  it.each(['sessionId', 'messages', 'userMessage', 'model'] as const)(
    '必須フィールド %s の欠落を拒否する',
    key => {
      const { [key]: _omitted, ...input } = validInput;
      expect(continueChatSchema.safeParse(input).success).toBe(false);
    }
  );
});
