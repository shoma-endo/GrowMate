/**
 * バリデーション共通プリミティブ（サーバー・クライアント共用）
 *
 * 純粋性制約: このファイルの依存は以下に限定する
 * - zod
 * - ERROR_MESSAGES（文字列定数のみ）
 * - 標準ライブラリ
 *
 * Supabase・環境変数・Node.js 固有モジュールは使用禁止。
 */

import { z } from 'zod';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const V = ERROR_MESSAGES.VALIDATION;

// --- 定数（クライアント・サーバーで共有） ---
export const TITLE_MAX_LENGTH = 60;

// --- オプショナルURL・メール（空文字→undefined、値あり時のみ形式チェック） ---
// Zod 4: トップレベル z.url() / z.email() を使用

const urlSchema = z.url();
const emailSchema = z.email();

export const optionalUrl = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val === '') return true;
      return urlSchema.safeParse(val).success;
    },
    { error: V.INVALID_URL }
  )
  .transform(val => (val === '' ? undefined : val));

export const optionalEmail = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val === '') return true;
      return emailSchema.safeParse(val).success;
    },
    { error: V.INVALID_EMAIL }
  )
  .transform(val => (val === '' ? undefined : val));

// --- 日付（YYYY-MM-DD 形式 + 実在チェック） ---

export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: V.DATE_FORMAT_INVALID })
  .refine(
    value => {
      const parts = value.split('-').map(Number);
      const y = parts[0];
      const m = parts[1];
      const d = parts[2];
      if (y === undefined || m === undefined || d === undefined) return false;
      const date = new Date(y, m - 1, d);
      return (
        date.getFullYear() === y &&
        date.getMonth() === m - 1 &&
        date.getDate() === d
      );
    },
    { error: V.DATE_INVALID }
  );

/** 日付範囲検証用 refine（startDate <= endDate）。startDate/endDate を持つ任意のオブジェクトで利用可能。
 * 前提: startDate / endDate は YYYY-MM-DD 形式の有効な日付文字列であること（dateStringSchema 等で事前検証済み）。 */
export const dateRangeRefinement = {
  refine: <T extends { startDate: string; endDate: string }>(data: T) => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    return start <= end;
  },
  message: V.DATE_RANGE_ORDER_INVALID,
};

/** 日付範囲スキーマ（startDate, endDate 必須 + 順序チェック） */
export const dateRangeSchema = z
  .object({
    startDate: dateStringSchema,
    endDate: dateStringSchema,
  })
  .refine(dateRangeRefinement.refine, { error: dateRangeRefinement.message });

// --- タイトル（チャットセッション等） ---

export const titleSchema = z
  .string()
  .trim()
  .min(1, { error: V.TITLE_REQUIRED })
  .max(TITLE_MAX_LENGTH, { error: V.TITLE_MAX_LENGTH(TITLE_MAX_LENGTH) });

// --- Google Ads 用 ---

export const customerIdSchema = z.string().regex(/^\d{10}$/, {
  error: V.CUSTOMER_ID_FORMAT,
});

export const campaignIdSchema = z.string().regex(/^\d+$/, {
  error: V.CAMPAIGN_ID_FORMAT,
});

// --- GA4 用 ---

export const ga4PropertyIdSchema = z
  .string()
  .min(1, { error: V.GA4_PROPERTY_ID_REQUIRED });

const GA4_CONVERSION_EVENTS_MAX = 50;

export const ga4ConversionEventsSchema = z
  .array(z.string().min(1, { error: V.GA4_EVENT_NAME_REQUIRED }))
  .max(GA4_CONVERSION_EVENTS_MAX, {
    error: V.GA4_CONVERSION_EVENTS_MAX(GA4_CONVERSION_EVENTS_MAX),
  })
  .optional();

// --- クライアント向けヘルパー（safeParse の薄いラッパー） ---

/** タイトル検証。エラー時はメッセージを、成功時は null を返す */
export function validateTitle(value: string): string | null {
  const result = titleSchema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? null);
}

/** URL検証（空文字はOK、値あり時のみ形式チェック）。エラー時はメッセージを返す */
export function validateOptionalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const result = urlSchema.safeParse(trimmed);
  return result.success ? null : V.INVALID_URL;
}

/**
 * 日付範囲検証（startDate, endDate を YYYY-MM-DD で受け取る）。
 * エラー時はメッセージを、成功時は null を返す。
 */
export function validateDateRange(start: string, end: string): string | null {
  if (!start?.trim() || !end?.trim()) return V.DATE_RANGE_REQUIRED;
  const result = dateRangeSchema.safeParse({
    startDate: start.trim(),
    endDate: end.trim(),
  });
  return result.success ? null : (result.error.issues[0]?.message ?? null);
}
