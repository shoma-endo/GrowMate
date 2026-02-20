/**
 * 日付・時刻ユーティリティ関数
 */

/**
 * ISO8601形式の日時文字列を「2025年12月11日 12:34」形式にフォーマット
 * @param isoString - ISO8601形式の日時文字列
 * @returns 日本語フォーマットの日時文字列
 */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '日付不明';
  }
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
  return formatter.format(date);
}

/**
 * 最終ログイン日時などの詳細表示用フォーマット（秒付き）
 * @param timestamp - ISO形式の日時文字列（オプショナル）
 * @param fallback - 日時が無効な場合の表示文字列（デフォルト: '不明'）
 * @returns フォーマット済みの日時文字列、または fallback
 */
export function formatDateTimeWithSeconds(
  timestamp?: string | null,
  fallback: string = '不明'
): string {
  if (!timestamp) return fallback;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return fallback;

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

/**
 * 相対日付フォーマット（今日/昨日/日付）
 * SessionListContent で使用
 * JST（日本標準時）で日付を比較します
 */
export function formatRelativeDate(date: Date): string {
  const now = new Date();

  // JST での日付文字列を取得（タイムゾーン変換は Intl に任せる）
  const getJstDateString = (d: Date): string => {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Tokyo',
    }).format(d);
  };

  // JST での「今日」「昨日」を計算するため、UTC基準で日付を操作
  // 注: Intl.DateTimeFormat が timeZone: 'Asia/Tokyo' で正しく変換してくれるため、
  // now をそのまま渡せばJSTでの「今日」が得られる
  const todayStr = getJstDateString(now);

  // 「昨日」は24時間前の瞬間をJSTでフォーマット
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = getJstDateString(yesterdayDate);

  const dateStr = getJstDateString(date);

  if (dateStr === todayStr) {
    return '今日';
  } else if (dateStr === yesterdayStr) {
    return '昨日';
  } else {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Tokyo',
    }).format(date);
  }
}

/**
 * ISO日付文字列をフォーマット済み日付文字列に変換
 * GscSetupClient で使用
 *
 * @param value - ISO形式の日付文字列
 * @returns フォーマット済みの日付文字列（日本語、中程度の日付スタイル + 短い時刻スタイル）、または null
 */
export function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

/**
 * Date オブジェクトを YYYY-MM-DD 形式の ISO 日付文字列に変換する（UTC）
 * @param date - Date オブジェクト
 * @returns YYYY-MM-DD 形式の日付文字列
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Date を JST（Asia/Tokyo）のカレンダー日付で YYYY-MM-DD に変換する
 * toISOString() は UTC のため JST と日付がずれる場合がある（例: JST 2026-02-08 01:00 → UTC 2026-02-07）
 * @param date - Date オブジェクト
 * @returns YYYY-MM-DD 形式の日付文字列（JST）
 */
export function formatJstDateISO(date: Date): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  if (!year || !month || !day) {
    // フォールバック: JST = UTC+9 なのでオフセットを足してから UTC 日付を取る
    const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return jstDate.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

/**
 * タイムスタンプ文字列を JST の YYYY-MM-DD に変換する
 * @param timestamp - ISO 形式などの日時文字列
 * @returns YYYY-MM-DD 形式の日付文字列（JST）
 * @throws Error タイムスタンプが無効な場合
 */
export function getJstDateISOFromTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }
  return formatJstDateISO(date);
}

/**
 * Date オブジェクトを JST（Asia/Tokyo）基準の YYYY-MM-DD 形式に変換する
 * サーバーのローカルタイムゾーンに依存せず、常に JST で日付を切り出す
 * @param date - Date オブジェクト
 * @returns YYYY-MM-DD 形式の日付文字列（JST）
 */
export function formatLocalDateYMD(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * JST（Asia/Tokyo）基準で「今日から N 日前〜今日」の日付範囲を返す
 * サーバーのローカルタイムゾーンに依存せず、常に JST で日付を切り出す
 * Google Ads API など YYYY-MM-DD 形式の日付範囲が必要な場合に使用する
 * @param days - 取得する日数（例: 30 → 今日含む過去30日間）
 * @returns { startDate, endDate } - YYYY-MM-DD 形式の開始日と終了日
 */
export function buildLocalDateRange(days: number): { startDate: string; endDate: string } {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('days must be a positive integer');
  }
  const now = new Date();
  const endDate = formatLocalDateYMD(now);
  // UTC ms 演算で days-1 日前を求め、JST で日付を切り出す
  const startDate = formatLocalDateYMD(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  return { startDate, endDate };
}

/**
 * ISO日付文字列に指定日数を加算する
 * @param isoDate - YYYY-MM-DD 形式の日付文字列
 * @param days - 加算する日数
 * @returns YYYY-MM-DD 形式の日付文字列
 */
export function addDaysISO(isoDate: string, days: number): string {
  // 入力形式の検証
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('isoDate must be in YYYY-MM-DD format');
  }
  if (!Number.isInteger(days)) {
    throw new Error('days must be an integer');
  }

  // 'YYYY-MM-DD' を UTC として解釈させるため 'T00:00:00Z' を付与
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateISO(date);
}

/**
 * OAuth の expires_in（秒）を ISO 形式の日時文字列に変換する
 * @param expiresIn - 有効期限（秒）
 * @returns ISO 8601 形式の日時文字列
 */
export function expiresInToISOString(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

/**
 * GSCの取得レンジを算出（GSCは2日前まで）
 * @param days - 取得する日数
 * @returns { startIso, endIso } - YYYY-MM-DD 形式の開始日と終了日
 */
export function buildGscDateRange(days: number): { startIso: string; endIso: string } {
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 2);
  const endIso = formatDateISO(endDate);
  const startIso = addDaysISO(endIso, -(days - 1));

  return {
    startIso,
    endIso,
  };
}
