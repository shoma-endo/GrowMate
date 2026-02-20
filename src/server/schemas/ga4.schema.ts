import { z } from 'zod';

export const ga4PropertyIdSchema = z.string().min(1, { error: 'GA4プロパティIDは必須です' });

export const ga4ConversionEventsSchema = z
  .array(z.string().min(1, { error: 'イベント名は必須です' }))
  .max(50)
  .optional();

export const ga4ThresholdEngagementSchema = z
  .number()
  .int()
  .min(0)
  .max(86400)
  .optional();

export const ga4ThresholdReadRateSchema = z
  .number()
  .min(0)
  .max(1)
  .optional();

export const ga4SettingsSchema = z.object({
  propertyId: ga4PropertyIdSchema,
  propertyName: z.string().optional(),
  conversionEvents: ga4ConversionEventsSchema,
  thresholdEngagementSec: ga4ThresholdEngagementSchema,
  thresholdReadRate: ga4ThresholdReadRateSchema,
});

export type Ga4SettingsInput = z.infer<typeof ga4SettingsSchema>;
