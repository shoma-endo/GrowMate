import { z } from 'zod';
import { KNOWLEDGE_SOURCE_OVERRIDE_MAX_CHARS } from '@/lib/knowledgeSourceOverride';

const knowledgeSourceOverrideTextSchema = z
  .string()
  .max(
    KNOWLEDGE_SOURCE_OVERRIDE_MAX_CHARS,
    `検証テキストは ${KNOWLEDGE_SOURCE_OVERRIDE_MAX_CHARS.toLocaleString()} 字以内にしてください`
  )
  .optional();

export const startChatSchema = z.object({
  userMessage: z.string(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  serviceId: z.string().optional(),
  knowledgeSourceOverrideText: knowledgeSourceOverrideTextSchema,
});

export const continueChatSchema = z.object({
  sessionId: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    })
  ),
  userMessage: z.string(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  serviceId: z.string().optional(),
  knowledgeSourceOverrideText: knowledgeSourceOverrideTextSchema,
});

export type StartChatInput = z.infer<typeof startChatSchema>;
export type ContinueChatInput = z.infer<typeof continueChatSchema>;
