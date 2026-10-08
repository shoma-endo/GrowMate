import { z } from 'zod';
import { INSTAGRAM_BLOG_DRAFT_MAX_SELECTION } from '@/lib/instagram-blog-draft';

export const startInstagramBlogDraftSchema = z.object({
  instagramMediaIds: z.array(z.uuid()).min(1).max(INSTAGRAM_BLOG_DRAFT_MAX_SELECTION).refine(ids => new Set(ids).size === ids.length),
});

export const continueInstagramBlogDraftSchema = z.object({
  batchId: z.uuid(),
});
