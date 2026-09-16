import { z } from 'zod';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { optionalEmail, optionalUrl } from '@/lib/validators/common';

const validationMessages = ERROR_MESSAGES.VALIDATION;

export const paymentEnum = z.enum([
  '現金',
  '銀行振込',
  'クレジットカード（VISA）',
  'クレジットカード（Master）',
  'クレジットカード（AMEX）',
  'クレジットカード（Diners）',
  'クレジットカード（JCB）',
  '分割払い',
]);

/**
 * 保存済み `briefs.data` の payments 用。表示ラベル（paymentEnum.options）と違い、
 * 過去の表記で保存された値も受け取る。
 *
 * 2026-08-26 の commit 0757789b で括弧を半角から全角へ変えた（ui-text.md §8）。
 * DB には半角括弧の値が残っているため、正規化せずに enum へ当てると briefInputSchema が
 * 落ちる。落ちると migrateOldBriefToNew が旧形式変換に回り、事業者情報が画面からも
 * プロンプトからも無言で消える。保存時も同じ経路を通るので、保存し直すと全角へ揃う。
 *
 * 天井: 救えるのは括弧の全角/半角だけ。paymentEnum のラベル自体を変えると（例:
 * 「分割払い」→「分割払い（回数指定可）」）同じ事故が再発する。ラベルを変えるなら、
 * DB 保存値と表示ラベルを分けるか、briefs.data のバックフィルを同じ PR で行う。
 * 全行が全角へ揃ったことを確認できたら、この schema ごと削除してよい。
 */
export const storedPaymentSchema = z.preprocess(
  value => (typeof value === 'string' ? value.replace(/\(/g, '（').replace(/\)/g, '）') : value),
  paymentEnum
);

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
  payments: z.array(storedPaymentSchema).optional(),
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
