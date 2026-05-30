import { z } from 'zod';

export const updateNegativeKeywordsSuggestionSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    sendHourJst: z
      .number()
      .int('配信時刻は整数で入力してください')
      .min(0, '配信時刻は0時以上である必要があります')
      .max(23, '配信時刻は23時以下である必要があります')
      .optional(),
  })
  .refine(value => value.enabled !== undefined || value.sendHourJst !== undefined, {
    message: '更新対象が指定されていません',
  });

export type UpdateNegativeKeywordsSuggestionSettingsInput = z.infer<
  typeof updateNegativeKeywordsSuggestionSettingsSchema
>;
