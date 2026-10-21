import { z } from 'zod';

import { CONTENT_CSV_IMPORT_LIMITS } from '@/lib/content-csv-import';
const annotationValuesSchema = z.object({
  main_kw: z.string().optional(),
  kw: z.string().optional(),
  impressions: z.string().optional(),
  needs: z.string().optional(),
  persona: z.string().optional(),
  goal: z.string().optional(),
  prep: z.string().optional(),
  basic_structure: z.string().optional(),
  opening_proposal: z.string().optional(),
}).strict();

const contentCsvImportRowSchema = z.object({
  rowNumber: z.number().int().min(2),
  url: z.string(),
  values: annotationValuesSchema,
}).strict();

export const contentCsvImportSchema = z.object({
  rows: z.array(contentCsvImportRowSchema).max(CONTENT_CSV_IMPORT_LIMITS.maxBatchRows),
}).strict();

