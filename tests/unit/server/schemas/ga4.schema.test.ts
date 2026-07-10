import { describe, expect, it } from 'vitest';

import { ga4SettingsSchema } from '@/server/schemas/ga4.schema';

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
