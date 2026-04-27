import { z } from 'zod';
import {
  ga4ConversionEventsSchema,
  ga4PropertyIdSchema,
} from '@/lib/validators/common';

const ga4ThresholdEngagementSchema = z
  .number()
  .int()
  .min(0)
  .max(86400)
  .optional();

const ga4ThresholdReadRateSchema = z
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
