/**
 * GA4 系スキーマの検証
 *
 * 取込設定・同期リクエスト（`ga4.schema`）と、コンテンツ評価の入力
 * （`ga4ContentEvaluation.schema`）。どのスキーマの検査かは外側の describe が示す。
 */
import { describe, expect, it } from 'vitest';
import { ga4SettingsSchema, ga4SyncRequestSchema } from '@/server/schemas/ga4.schema';
import {
  ga4ContentEvaluationInputSchema,
  ga4EvaluationLlmOutputSchema,
} from '@/server/schemas/ga4ContentEvaluation.schema';

describe('@/server/schemas/ga4.schema', () => {
  describe('ga4SyncRequestSchema', () => {
    it.each([undefined, {}])('backfillDays未指定のリクエスト %s を受理する', value => {
      expect(ga4SyncRequestSchema.safeParse(value).success).toBe(true);
    });

    it.each([1, 90])('backfillDays=%sを受理する', backfillDays => {
      expect(ga4SyncRequestSchema.safeParse({ backfillDays }).success).toBe(true);
    });

    it.each([0, 91, 1.5, '90'])('不正なbackfillDays=%sを拒否する', backfillDays => {
      expect(ga4SyncRequestSchema.safeParse({ backfillDays }).success).toBe(false);
    });
  });

  describe('ga4SettingsSchema', () => {
    it('propertyIdのみを受理し、optional項目のundefinedを許可する', () => {
      expect(
        ga4SettingsSchema.safeParse({
          propertyId: '123456789',
          conversionEvents: undefined,
          thresholdEngagementSec: undefined,
          thresholdReadRate: undefined,
        }).success
      ).toBe(true);
    });

    it('propertyId欠落を拒否する', () => {
      expect(ga4SettingsSchema.safeParse({}).success).toBe(false);
    });

    it('空のpropertyIdを拒否する', () => {
      expect(ga4SettingsSchema.safeParse({ propertyId: '' }).success).toBe(false);
    });

    it.each([0, 86400])('engagement境界値 %s を受理する', value => {
      expect(
        ga4SettingsSchema.safeParse({
          propertyId: '123456789',
          thresholdEngagementSec: value,
        }).success
      ).toBe(true);
    });

    it.each([-1, 86401, 1.5])('不正engagement値 %s を拒否する', value => {
      expect(
        ga4SettingsSchema.safeParse({
          propertyId: '123456789',
          thresholdEngagementSec: value,
        }).success
      ).toBe(false);
    });

    it.each([0, 1])('read rate境界値 %s を受理する', value => {
      expect(
        ga4SettingsSchema.safeParse({
          propertyId: '123456789',
          thresholdReadRate: value,
        }).success
      ).toBe(true);
    });

    it.each([-0.01, 1.01])('不正read rate値 %s を拒否する', value => {
      expect(
        ga4SettingsSchema.safeParse({
          propertyId: '123456789',
          thresholdReadRate: value,
        }).success
      ).toBe(false);
    });

    it('conversion eventsを50件まで受理する', () => {
      expect(
        ga4SettingsSchema.safeParse({
          propertyId: '123456789',
          conversionEvents: Array.from({ length: 50 }, (_, index) => `event_${index}`),
        }).success
      ).toBe(true);
    });

    it('conversion eventsが51件なら拒否する', () => {
      expect(
        ga4SettingsSchema.safeParse({
          propertyId: '123456789',
          conversionEvents: Array.from({ length: 51 }, (_, index) => `event_${index}`),
        }).success
      ).toBe(false);
    });
  });
});

describe('@/server/schemas/ga4ContentEvaluation.schema', () => {
  const valid = {
    headline: '見出し',
    situation: '状況',
    cause: '原因',
    next_action: '次の一手',
    target: '対象',
  };

  describe('ga4ContentEvaluation.schema', () => {
    it('5フィールドを検証し、スコア項目を受け付けない', () => {
      expect(ga4EvaluationLlmOutputSchema.safeParse(valid).success).toBe(true);
      expect(ga4EvaluationLlmOutputSchema.safeParse({ ...valid, headline: 'x'.repeat(121) }).success).toBe(false);
      expect(ga4EvaluationLlmOutputSchema.safeParse({ ...valid, score: 99, pattern: 'R_GOOD' }).success).toBe(false);
      expect(ga4EvaluationLlmOutputSchema.safeParse({ ...valid, cause: undefined }).success).toBe(false);
    });

    it('評価期間は90日以内かつ開始日以前の終了日を要求する', () => {
      expect(ga4ContentEvaluationInputSchema.safeParse({
        annotationId: '00000000-0000-4000-8000-000000000001',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      }).success).toBe(true);
      expect(ga4ContentEvaluationInputSchema.safeParse({
        annotationId: '00000000-0000-4000-8000-000000000001',
        startDate: '2026-01-01',
        endDate: '2026-04-01',
      }).success).toBe(false);
      expect(ga4ContentEvaluationInputSchema.safeParse({
        annotationId: '00000000-0000-4000-8000-000000000001',
        startDate: '2026-04-01',
        endDate: '2026-03-31',
      }).success).toBe(false);
    });
  });
});
