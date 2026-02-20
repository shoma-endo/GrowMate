/**
 * date-fns の型定義
 * GA4 Data API で日付集計を行うためのユーティリティ
 */

export interface DateRange {
  start?: string;
  end?: string;
}

/**
 * 直近N日の範囲を取得（JST）
 * @param days 取得日数（昨日を含む）
 * @returns { startDate: string; endDate: string } 日付範囲
 */
export declare function getDateRange(
  days: number
): { startDate: string; endDate: string };
