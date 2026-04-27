import { z } from 'zod';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { optionalEmail, optionalUrl } from '@/lib/validators/common';

const validationMessages = ERROR_MESSAGES.VALIDATION;

export const paymentEnum = z.enum([
  '現金',
  '銀行振込',
  'クレジットカード(VISA)',
  'クレジットカード(Master)',
  'クレジットカード(AMEX)',
  'クレジットカード(Diners)',
  'クレジットカード(JCB)',
  '分割払い',
]);

const serviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, { message: validationMessages.SERVICE_NAME_REQUIRED }),
  strength: z.string().optional(),
  when: z.string().optional(),
  where: z.string().optional(),
  who: z.string().optional(),
  why: z.string().optional(),
  what: z.string().optional(),
  how: z.string().optional(),
  price: z.string().optional(),
});

const profileSchema = z.object({
  company: z.string().optional(),
  address: z.string().optional(),
  ceo: z.string().optional(),
  hobby: z.string().optional(),
  staff: z.string().optional(),
  staffHobby: z.string().optional(),
  businessHours: z.string().optional(),
  holiday: z.string().optional(),
  tel: z.string().optional(),
  license: z.string().optional(),
  qualification: z.string().optional(),
  capital: z.string().optional(),
  email: optionalEmail,
  payments: z.array(paymentEnum).optional(),
  benchmarkUrl: optionalUrl,
  competitorCopy: z.string().optional(),
});

export const briefInputSchema = z.object({
  profile: profileSchema,
  persona: z.string().optional(),
  services: z.array(serviceSchema).min(1, { message: validationMessages.SERVICE_MIN_COUNT }),
});

export type Service = z.infer<typeof serviceSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type BriefInput = z.infer<typeof briefInputSchema>;
export type Payment = z.infer<typeof paymentEnum>;
