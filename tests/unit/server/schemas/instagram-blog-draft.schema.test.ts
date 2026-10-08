import { describe, expect, it } from 'vitest';
import {
  continueInstagramBlogDraftSchema,
  startInstagramBlogDraftSchema,
} from '@/server/schemas/instagram-blog-draft.schema';

describe('Instagram blog draft request schemas', () => {
  it('start accepts 1–10 unique UUIDs and rejects the limits and malformed IDs', () => {
    const ids = Array.from({ length: 10 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    expect(startInstagramBlogDraftSchema.safeParse({ instagramMediaIds: [ids[0]] }).success).toBe(true);
    expect(startInstagramBlogDraftSchema.safeParse({ instagramMediaIds: ids }).success).toBe(true);
    expect(startInstagramBlogDraftSchema.safeParse({ instagramMediaIds: [] }).success).toBe(false);
    expect(startInstagramBlogDraftSchema.safeParse({ instagramMediaIds: [...ids, '00000000-0000-4000-8000-000000000011'] }).success).toBe(false);
    expect(startInstagramBlogDraftSchema.safeParse({ instagramMediaIds: [ids[0], ids[0]] }).success).toBe(false);
    expect(startInstagramBlogDraftSchema.safeParse({ instagramMediaIds: ['not-a-uuid'] }).success).toBe(false);
  });

  it('continue requires a batch UUID', () => {
    expect(continueInstagramBlogDraftSchema.safeParse({ batchId: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
    expect(continueInstagramBlogDraftSchema.safeParse({ batchId: 'batch-1' }).success).toBe(false);
  });
});
