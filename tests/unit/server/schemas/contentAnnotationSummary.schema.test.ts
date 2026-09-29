import { describe, expect, it } from 'vitest';

import { summarizeContentAnnotationSchema } from '@/server/schemas/contentAnnotationSummary.schema';

describe('summarizeContentAnnotationSchema', () => {
  it.each([{ sessionId: 'session-id' }, { annotationId: 'annotation-id' }])(
    '対象IDのいずれか一方だけなら受理する: %o',
    value => {
      expect(summarizeContentAnnotationSchema.safeParse(value).success).toBe(true);
    }
  );

  it.each([{}, { sessionId: '', annotationId: undefined }, { sessionId: 's', annotationId: 'a' }])(
    '対象IDが不正な場合は拒否する: %o',
    value => {
      expect(summarizeContentAnnotationSchema.safeParse(value).success).toBe(false);
    }
  );
});
