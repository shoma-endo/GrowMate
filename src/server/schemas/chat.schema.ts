import { z } from 'zod';

export const startChatSchema = z.object({
  userMessage: z.string(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  serviceId: z.string().optional(),
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
});

export type StartChatInput = z.infer<typeof startChatSchema>;
export type ContinueChatInput = z.infer<typeof continueChatSchema>;
