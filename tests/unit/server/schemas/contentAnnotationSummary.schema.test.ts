import { describe, expect, it } from 'vitest';

import { summarizeContentAnnotationSchema } from '@/server/schemas/contentAnnotationSummary.schema';

describe('summarizeContentAnnotationSchema', () => {
  it('sessionIdのみを受理する', () => {
    expect(summarizeContentAnnotationSchema.safeParse({ sessionId: 'session-id' }).success).toBe(
      true
    );
  });

  it('annotationIdのみを受理する', () => {
    expect(
      summarizeContentAnnotationSchema.safeParse({ annotationId: 'annotation-id' }).success
    ).toBe(true);
  });

  it.each([{}, { sessionId: '', annotationId: undefined }, { sessionId: 's', annotationId: 'a' }])(
    '対象IDが不正な場合は拒否する: %o',
    value => {
      expect(summarizeContentAnnotationSchema.safeParse(value).success).toBe(false);
    }
  );
});
