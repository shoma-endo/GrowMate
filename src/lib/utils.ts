import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

export function normalizeCategories(value: number[] | undefined): number[] | null {
  return Array.isArray(value) && value.length > 0 ? value : null;
}

export function normalizeCategoryNames(value: string[] | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value.filter(name => typeof name === 'string' && name.trim().length > 0);
  return names.length > 0 ? names : null;
}

export function normalizeText(value: string | undefined | null): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function parseWpPostId(id: unknown): number | null {
  return typeof id === 'number' ? id : Number.isFinite(Number(id)) ? Number(id) : null;
}

export function areArraysEqual<T>(a: T[] | null, b: T[] | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * 数値をフォーマット（カンマ区切り）
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('ja-JP');
}

/**
 * 金額をフォーマット（円記号 + カンマ区切り）
 */
export function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

/**
 * パーセンテージをフォーマット
 */
export function formatPercent(value: number | null): string {
  if (value === null) return '-';
  return `${(value * 100).toFixed(2)}%`;
}
