import { z } from 'zod';

export const wordpressPublishDefaultsSchema = z.object({
  annotationId: z.uuidv4().optional(),
  sessionId: z.uuidv4().optional(),
}).refine(value => Boolean(value.annotationId || value.sessionId));

export const wordpressPublishInputSchema = z.object({
  annotationId: z.uuidv4().optional(),
  sessionId: z.uuidv4().optional(),
  title: z.string().trim().min(1).max(200),
  contentType: z.enum(['posts', 'pages']),
  status: z.enum(['draft', 'future', 'publish']),
  scheduledAt: z.iso.datetime().optional(),
  categoryIds: z.array(z.number().int().positive()).max(100).optional(),
  slug: z.string().max(200).optional(),
}).refine(value => Boolean(value.annotationId || value.sessionId));

export const wordpressBulkPublishInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ids'), contentAnnotationIds: z.array(z.uuidv4()).max(1000) }),
  z.object({ mode: z.literal('all'), excludedIds: z.array(z.uuidv4()).max(1000).optional() }),
]);
