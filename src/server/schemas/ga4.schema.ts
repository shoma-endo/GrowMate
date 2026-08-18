import { z } from 'zod';
import {
  ga4ConversionEventsSchema,
  ga4PropertyIdSchema,
} from '@/lib/validators/common';
import { GA4_EVALUATION_DEFAULT_DAYS } from '@/lib/ga4-evaluation-period';

export const ga4SyncRequestSchema = z
  .object({
    backfillDays: z.int().min(1).max(GA4_EVALUATION_DEFAULT_DAYS).optional(),
  })
  .optional();

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
