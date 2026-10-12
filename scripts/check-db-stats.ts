import { createClient } from '@supabase/supabase-js';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import ws from 'ws';
import { loadEnv } from './lib/load-env';

// PostgreSQL接続用の型定義（pgライブラリがインストールされていない場合のフォールバック）
interface TableSizeInfo {
  table_name: string;
  size_pretty: string;
  size_bytes: number;
}

interface DatabaseSizeInfo {
  database_size_pretty: string;
  database_size_bytes: number;
}

interface TableSnapshot {
  sizeBytes: number;
  recordCount: number;
}

/** データのある日だけで集計した、1ユーザーの1日あたり行数 */
interface UserDailyRowStat {
  name: string;
  avgPerDay: number;
  sdPerDay: number;
  maxPerDay: number;
  daysWithData: number;
}

type UserDailyRowStats = Record<string, UserDailyRowStat>;

/**
 * ユーザー別に1日あたり行数を数える日次メトリクス表。
 * 各表のユニーク制約が (user_id, <プロパティ列>, date, ...) で始まるため、この3列で絞った count は索引で引ける
 */
const DAILY_ROW_BREAKDOWNS = [
  {
    key: 'gscQuery',
    label: 'GSCクエリ',
    table: 'gsc_query_metrics',
    credentialPropertyColumn: 'property_uri',
    metricsPropertyColumn: 'property_uri',
  },
  {
    key: 'ga4Daily',
    label: 'GA4日次',
    table: 'ga4_page_metrics_daily',
    credentialPropertyColumn: 'ga4_property_id',
    metricsPropertyColumn: 'property_id',
  },
] as const;

type DailyRowBreakdown = (typeof DAILY_ROW_BREAKDOWNS)[number];
type DailyRowBreakdownKey = DailyRowBreakdown['key'];

interface DbStatsSnapshot {
  capturedAt: string;
  databaseSizeBytes: number;
  tables: Record<string, TableSnapshot>;
  /** 追加前に保存されたスナップショットには無い */
  dailyRowsByUser?: Partial<Record<DailyRowBreakdownKey, UserDailyRowStats>>;
}

interface TableShareWarning {
  name: string;
  sizeBytes: number;
  sharePercent: number;
  critical: boolean;
}

interface TableGrowth {
  name: string;
  deltaBytes: number;
  deltaPercent: number;
}

/** scripts/notify-db-stats.cjs が読む、Lark カード組み立て用の入力 */
interface DbStatsReport {
  capturedAt: string;
  previousCapturedAt: string | null;
  databaseSizeBytes: number;
  previousDatabaseSizeBytes: number | null;
  diskQuotaBytes: number;
  diskGrowthWarning: boolean;
  tables: { name: string; sizeBytes: number; previousSizeBytes: number | null }[];
  shareWarnings: TableShareWarning[];
  growthWarnings: TableGrowth[];
  dailyRowWindowDays: number;
  dailyRowBreakdowns: {
    key: DailyRowBreakdownKey;
    label: string;
    table: string;
    users: (UserDailyRowStat & { previousAvgPerDay: number | null })[];
    /** null は対象ユーザーの一覧すら取れず、内訳を集計していない */
    failedUserCount: number | null;
  }[];
}

/** Supabase Pro プランの含まれるクォータ（https://supabase.com/pricing 参照） */
const SUPABASE_PRO_PLAN = {
  diskSizeBytes: 8 * 1024 * 1024 * 1024,
  monthlyActiveUsers: 100_000,
  fileStorageBytes: 100 * 1024 * 1024 * 1024,
  egressBytes: 250 * 1024 * 1024 * 1024,
} as const;

const HISTORY_FILE_PATH = join(__dirname, 'db-stats-history.json');
const REPORT_FILE_PATH = join(__dirname, 'db-stats-report.json');

const DAILY_ROW_WINDOW_DAYS = 30;
const DAILY_ROW_COUNT_CONCURRENCY = 10;

/** テーブルが DB 全体のこの割合を超えたら警告 */
const TABLE_DISK_SHARE_WARN_PERCENT = 30;
const TABLE_DISK_SHARE_CRITICAL_PERCENT = 50;

/** 前回比で DB 全体がこの値を超えて増えたら警告 */
const DISK_GROWTH_WARN_MB = 50;
const DISK_GROWTH_WARN_PERCENT = 10;

/** 前回比でテーブルがこの値を超えて増えたら警告 */
const TABLE_GROWTH_WARN_MB = 20;
const TABLE_GROWTH_WARN_PERCENT = 15;
const TABLE_GROWTH_MIN_MB = 5;

function formatBytesAsGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

function formatBytesAsMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function formatSignedMb(deltaBytes: number): string {
  const sign = deltaBytes >= 0 ? '+' : '-';
  return `${sign}${formatBytesAsMb(Math.abs(deltaBytes))}`;
}

function formatSignedPercent(deltaPercent: number): string {
  const sign = deltaPercent >= 0 ? '+' : '';
  return `${sign}${deltaPercent.toFixed(1)}`;
}

function loadPreviousSnapshot(): DbStatsSnapshot | null {
  try {
    const raw = readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as DbStatsSnapshot;
    if (
      typeof parsed.capturedAt !== 'string' ||
      typeof parsed.databaseSizeBytes !== 'number' ||
      typeof parsed.tables !== 'object'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot: DbStatsSnapshot): void {
  writeFileSync(HISTORY_FILE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
}

function buildSnapshot(
  databaseSizeBytes: number,
  tableSizes: TableSizeInfo[],
  tableCounts: Record<string, number>,
  dailyRowsByUser: NonNullable<DbStatsSnapshot['dailyRowsByUser']>
): DbStatsSnapshot {
  const tables: Record<string, TableSnapshot> = {};
  for (const tableSize of tableSizes) {
    tables[tableSize.table_name] = {
      sizeBytes: tableSize.size_bytes,
      recordCount: tableCounts[tableSize.table_name] ?? 0,
    };
  }

  return {
    capturedAt: new Date().toISOString(),
    databaseSizeBytes,
    tables,
    dailyRowsByUser,
  };
}

function findTableShareWarnings(
  tableSizes: TableSizeInfo[],
  databaseSizeBytes: number
): TableShareWarning[] {
  return tableSizes
    .map(table => {
      const sharePercent = (table.size_bytes / databaseSizeBytes) * 100;
      return {
        name: table.table_name,
        sizeBytes: table.size_bytes,
        sharePercent,
        critical: sharePercent >= TABLE_DISK_SHARE_CRITICAL_PERCENT,
      };
    })
    .filter(table => table.sharePercent >= TABLE_DISK_SHARE_WARN_PERCENT)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function printTableDiskShareWarnings(
  tableSizes: TableSizeInfo[],
  databaseSizeBytes: number | null
): void {
  console.log('\n🚨 ディスクボトルネック（テーブル別）:');

  if (!databaseSizeBytes || databaseSizeBytes === 0) {
    console.log('  ⚠️  データベースサイズが取得できず、テーブル占有率を判定できません。');
    return;
  }

  const warnings = findTableShareWarnings(tableSizes, databaseSizeBytes);

  if (warnings.length === 0) {
    console.log('  ✅ 単一テーブルの占有率が高いボトルネックは検出されませんでした。');
    return;
  }

  for (const table of warnings) {
    const icon = table.critical ? '🔴' : '⚠️';
    const level = table.critical ? '要対処' : '要監視';
    console.log(
      `  ${icon} ${table.name}: ${formatBytesAsMb(table.sizeBytes)} MB（DB全体の ${table.sharePercent.toFixed(1)}%）— ${level}`
    );
  }
}

function isDiskGrowthWarning(current: DbStatsSnapshot, previous: DbStatsSnapshot): boolean {
  const deltaBytes = current.databaseSizeBytes - previous.databaseSizeBytes;
  const deltaPercent =
    previous.databaseSizeBytes > 0 ? (deltaBytes / previous.databaseSizeBytes) * 100 : 0;
  return (
    deltaBytes / 1024 / 1024 >= DISK_GROWTH_WARN_MB ||
    (previous.databaseSizeBytes > 0 && deltaPercent >= DISK_GROWTH_WARN_PERCENT)
  );
}

function computeTableDeltas(current: DbStatsSnapshot, previous: DbStatsSnapshot): TableGrowth[] {
  return Object.entries(current.tables)
    .map(([name, currentTable]) => {
      const previousTable = previous.tables[name];
      if (!previousTable) {
        return null;
      }
      const deltaBytes = currentTable.sizeBytes - previousTable.sizeBytes;
      if (deltaBytes === 0) {
        return null;
      }
      const deltaPercent =
        previousTable.sizeBytes > 0 ? (deltaBytes / previousTable.sizeBytes) * 100 : 0;
      return { name, deltaBytes, deltaPercent };
    })
    .filter((row): row is TableGrowth => row !== null)
    .sort((a, b) => b.deltaBytes - a.deltaBytes);
}

function isSignificantTableGrowth(row: TableGrowth): boolean {
  return (
    row.deltaBytes >= TABLE_GROWTH_WARN_MB * 1024 * 1024 ||
    (row.deltaPercent >= TABLE_GROWTH_WARN_PERCENT &&
      row.deltaBytes >= TABLE_GROWTH_MIN_MB * 1024 * 1024)
  );
}

function printDeltaFromPrevious(current: DbStatsSnapshot, previous: DbStatsSnapshot | null): void {
  console.log('\n📈 前回実行との比較:');

  if (!previous) {
    console.log('  ℹ️  初回実行のため比較データがありません。');
    return;
  }

  const previousDate = new Date(previous.capturedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
  });
  console.log(`  前回: ${previousDate}`);

  const deltaBytes = current.databaseSizeBytes - previous.databaseSizeBytes;
  const deltaPercent =
    previous.databaseSizeBytes > 0 ? (deltaBytes / previous.databaseSizeBytes) * 100 : 0;

  console.log(
    `  📦 DB全体: ${formatSignedMb(deltaBytes)} MB (${formatSignedPercent(deltaPercent)}%)`
  );

  if (isDiskGrowthWarning(current, previous)) {
    console.log('  ⚠️  DB全体の増加率が閾値を超えています。データ肥大化を確認してください。');
  } else if (deltaBytes <= 0) {
    console.log('  ✅ DB全体のサイズは前回から増加していません。');
  } else {
    console.log('  ✅ DB全体の増加は閾値内です。');
  }

  const tableDeltas = computeTableDeltas(current, previous);
  const significantGrowth = tableDeltas.filter(isSignificantTableGrowth);

  if (significantGrowth.length > 0) {
    console.log('  急増テーブル:');
    for (const row of significantGrowth.slice(0, 5)) {
      console.log(
        `    ⚠️  ${row.name}: ${formatSignedMb(row.deltaBytes)} MB (${formatSignedPercent(row.deltaPercent)}%)`
      );
    }
  } else if (tableDeltas.length > 0) {
    console.log('  ✅ テーブル単位の急増は検出されませんでした。');
  }
}

function printProPlanQuotaAndRecommendations(databaseSizeBytes: number | null): void {
  console.log('\n💰 Supabase Pro プランのクォータ（参考）:');
  console.log('  - データベースディスク: 8 GB（超過分 $0.125/GB）');
  console.log(`  - 月間アクティブユーザー: ${SUPABASE_PRO_PLAN.monthlyActiveUsers.toLocaleString()}人`);
  console.log('  - ファイルストレージ: 100 GB');
  console.log('  - エグレス: 250 GB/月');
  console.log('  - 詳細: https://supabase.com/pricing');

  console.log('\n💡 クォータ利用状況:');
  if (databaseSizeBytes === null) {
    console.log('  ⚠️  ディスク使用量の判定ができませんでした。');
    return;
  }

  const usagePercent = (databaseSizeBytes / SUPABASE_PRO_PLAN.diskSizeBytes) * 100;
  console.log(
    `  📦 ディスク: ${formatBytesAsGb(databaseSizeBytes)} GB / 8 GB (${usagePercent.toFixed(1)}%)`
  );

  if (usagePercent >= 100) {
    console.log(
      '  ⚠️  含まれる 8 GB を超過しています。追加課金またはデータ整理・ディスク拡張を検討してください。'
    );
  } else if (usagePercent >= 80) {
    console.log(
      '  ⚠️  ディスク使用率が 80% を超えています。データ肥大化・不要データ削除を検討してください。'
    );
  } else {
    console.log('  ✅ ディスク使用率は Pro プランの範囲内です。');
  }

  console.log(
    '  ℹ️  MAU / ストレージ / エグレスは本スクリプトでは計測していません（Supabase Dashboard で確認）。'
  );
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStdDev(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

/** 昨日から遡って days 日分の日付（UTC の YYYY-MM-DD） */
function recentDates(days: number): string[] {
  return Array.from({ length: days }, (_, index) =>
    new Date(Date.now() - (index + 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
}

/**
 * プロパティを設定済みのユーザーごとに、日次メトリクス表の1日あたり行数を集計する。
 * 表全体の count は gsc_query_metrics で失敗するほど重いため、ユーザー×日の count を積み上げる
 */
async function collectDailyRowsByUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  breakdown: DailyRowBreakdown,
  nameById: Map<string, string | null>
): Promise<{ stats: UserDailyRowStats; failedUserCount: number }> {
  const { data: credentials, error: credentialError } = await client
    .from('gsc_credentials')
    .select(`user_id, ${breakdown.credentialPropertyColumn}`)
    .not(breakdown.credentialPropertyColumn, 'is', null);
  if (credentialError) {
    throw new Error(`gsc_credentials の取得に失敗しました: ${credentialError.message}`);
  }

  const targets = (
    (credentials ?? []) as Record<'user_id' | DailyRowBreakdown['credentialPropertyColumn'], string>[]
  ).map(row => ({
    userId: row.user_id,
    property: row[breakdown.credentialPropertyColumn],
  }));
  const dates = recentDates(DAILY_ROW_WINDOW_DAYS);
  const stats: UserDailyRowStats = {};
  let failedUserCount = 0;

  for (const target of targets) {
    const countForDate = async (date: string): Promise<number> => {
      const { count, error } = await client
        .from(breakdown.table)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', target.userId)
        .eq(breakdown.metricsPropertyColumn, target.property)
        .eq('date', date);
      if (error) {
        throw new Error(`${date}: ${error.message}`);
      }
      return count ?? 0;
    };

    try {
      const counts: number[] = [];
      for (let index = 0; index < dates.length; index += DAILY_ROW_COUNT_CONCURRENCY) {
        const chunk = dates.slice(index, index + DAILY_ROW_COUNT_CONCURRENCY);
        counts.push(...(await Promise.all(chunk.map(countForDate))));
      }
      const daysWithRows = counts.filter(count => count > 0);
      stats[target.userId] = {
        name: nameById.get(target.userId) || '未設定',
        avgPerDay: daysWithRows.length > 0 ? mean(daysWithRows) : 0,
        sdPerDay: daysWithRows.length > 0 ? populationStdDev(daysWithRows) : 0,
        maxPerDay: daysWithRows.length > 0 ? Math.max(...daysWithRows) : 0,
        daysWithData: daysWithRows.length,
      };
    } catch (error) {
      failedUserCount += 1;
      console.error(`${breakdown.table} のユーザー別集計に失敗しました:`, {
        userId: target.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { stats, failedUserCount };
}

async function loadUserNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
): Promise<Map<string, string | null>> {
  // 全件を1リクエストで読む。PostgREST の max_rows（Supabase 既定 1000）を超えたら超過分が「未設定」になるのでページングにする
  const { data, error } = await client.from('users').select('id, full_name');
  if (error) {
    throw new Error(`users の取得に失敗しました: ${error.message}`);
  }
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[]).map(user => [
      user.id,
      user.full_name,
    ])
  );
}

function sortUsersByAvg(stats: UserDailyRowStats): [string, UserDailyRowStat][] {
  return Object.entries(stats).sort(([, a], [, b]) => b.avgPerDay - a.avgPerDay);
}

function printDailyRowsByUser(
  breakdown: DailyRowBreakdown,
  stats: UserDailyRowStats,
  failedUserCount: number,
  previousStats: UserDailyRowStats | undefined
): void {
  console.log(
    `\n🔎 ${breakdown.label}の行数（${breakdown.table}・ユーザー別・直近${DAILY_ROW_WINDOW_DAYS}日のデータがある日の1日あたり）:`
  );

  const sorted = sortUsersByAvg(stats);
  const withData = sorted.filter(([, stat]) => stat.daysWithData > 0);
  if (withData.length === 0) {
    console.log('  ℹ️  対象期間にデータのあるユーザーはいません。');
  }
  for (const [userId, stat] of withData) {
    const previousAvg = previousStats?.[userId]?.avgPerDay;
    const delta =
      previousAvg === undefined ? '' : `（前回比 ${formatSignedNumber(stat.avgPerDay - previousAvg)}）`;
    console.log(
      `  ${stat.name}: 平均 ${Math.round(stat.avgPerDay).toLocaleString()} / 標準偏差 ${Math.round(stat.sdPerDay).toLocaleString()} / 最大 ${stat.maxPerDay.toLocaleString()} 行（${stat.daysWithData}日分）${delta}`
    );
  }

  if (withData.length > 0) {
    const averages = withData.map(([, stat]) => stat.avgPerDay);
    console.log(
      `  全体（${withData.length}人）: 平均 ${Math.round(mean(averages)).toLocaleString()} / 標準偏差 ${Math.round(populationStdDev(averages)).toLocaleString()} 行/日`
    );
  }
  console.log(`  データなし: ${sorted.length - withData.length}人`);
  if (failedUserCount > 0) {
    console.log(`  ⚠️  集計に失敗したユーザー: ${failedUserCount}人`);
  }
}

function formatSignedNumber(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : ''}${rounded.toLocaleString()}`;
}

function buildReport(
  current: DbStatsSnapshot,
  previous: DbStatsSnapshot | null,
  tableSizes: TableSizeInfo[],
  failedUserCounts: Partial<Record<DailyRowBreakdownKey, number>>
): DbStatsReport {
  return {
    capturedAt: current.capturedAt,
    previousCapturedAt: previous?.capturedAt ?? null,
    databaseSizeBytes: current.databaseSizeBytes,
    previousDatabaseSizeBytes: previous?.databaseSizeBytes ?? null,
    diskQuotaBytes: SUPABASE_PRO_PLAN.diskSizeBytes,
    diskGrowthWarning: previous ? isDiskGrowthWarning(current, previous) : false,
    tables: [...tableSizes]
      .sort((a, b) => b.size_bytes - a.size_bytes)
      .map(table => ({
        name: table.table_name,
        sizeBytes: table.size_bytes,
        previousSizeBytes: previous?.tables[table.table_name]?.sizeBytes ?? null,
      })),
    shareWarnings: findTableShareWarnings(tableSizes, current.databaseSizeBytes),
    growthWarnings: previous
      ? computeTableDeltas(current, previous).filter(isSignificantTableGrowth)
      : [],
    dailyRowWindowDays: DAILY_ROW_WINDOW_DAYS,
    dailyRowBreakdowns: DAILY_ROW_BREAKDOWNS.map(breakdown => {
      const failedUserCount = failedUserCounts[breakdown.key];
      const previousStats = previous?.dailyRowsByUser?.[breakdown.key];
      return {
        key: breakdown.key,
        label: breakdown.label,
        table: breakdown.table,
        users:
          failedUserCount === undefined
            ? []
            : sortUsersByAvg(current.dailyRowsByUser?.[breakdown.key] ?? {}).map(
                ([userId, stat]) => ({
                  ...stat,
                  previousAvgPerDay: previousStats?.[userId]?.avgPerDay ?? null,
                })
              ),
        failedUserCount: failedUserCount ?? null,
      };
    }),
  };
}

/**
 * データベースから実際に存在するテーブル一覧を取得する
 * get_table_sizes RPC関数を使用して、実際のデータベースから直接取得
 */
async function getAllTables(client: ReturnType<typeof createClient>): Promise<string[]> {
  // get_table_sizes(NULL) を呼び出すと、publicスキーマ内の全テーブルを取得できる
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc('get_table_sizes', {
    table_names: null,
  });

  if (error) {
    throw new Error(
      `get_table_sizes RPC関数の呼び出しに失敗しました。` +
        `データベースにRPC関数がデプロイされているか確認してください。` +
        `詳細: ${error.message}`
    );
  }

  if (!data || !Array.isArray(data)) {
    throw new Error(
      `get_table_sizes RPC関数から有効なデータが返されませんでした。` +
        `データベーススキーマが正しくデプロイされているか確認してください。`
    );
  }

  // テーブル名のみを抽出してソート
  const tableNames = data.map((row: TableSizeInfo) => row.table_name).sort();
  return tableNames;
}

/**
 * SupabaseのRPC関数を使って容量情報を取得
 */
async function getDatabaseSizes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
): Promise<{
  databaseSize: DatabaseSizeInfo | null;
  tableSizes: TableSizeInfo[];
}> {
  // データベース全体のサイズを取得
  const { data: dbSizeData, error: dbSizeError } = await client.rpc('get_database_size');

  if (dbSizeError) {
    throw new Error(
      `get_database_size RPC関数の呼び出しに失敗しました。` +
        `データベースにRPC関数がデプロイされているか確認してください。` +
        `詳細: ${dbSizeError.message}`
    );
  }

  // テーブルごとのサイズを取得（全テーブル）
  const { data: tableSizeData, error: tableSizeError } = await client.rpc('get_table_sizes', {
    table_names: null, // NULLを渡して全テーブルを取得
  });

  if (tableSizeError) {
    throw new Error(
      `get_table_sizes RPC関数の呼び出しに失敗しました。` +
        `データベースにRPC関数がデプロイされているか確認してください。` +
        `詳細: ${tableSizeError.message}`
    );
  }

  // データの型を確認して適切に処理
  const databaseSize =
    dbSizeData && Array.isArray(dbSizeData) && dbSizeData.length > 0
      ? (dbSizeData[0] as DatabaseSizeInfo)
      : null;
  const tableSizes = (Array.isArray(tableSizeData) ? tableSizeData : []) as TableSizeInfo[];

  return {
    databaseSize,
    tableSizes,
  };
}

/**
 * Supabaseデータベースの統計情報を取得するスクリプト
 */
async function checkDatabaseStats() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRole = env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !supabaseServiceRole) {
    throw new Error('環境変数が設定されていません。.env.localファイルを確認してください。');
  }

  const previousSnapshot = loadPreviousSnapshot();
  // 途中で失敗した回に、前回分のレポートでカードが組まれないようにする
  rmSync(REPORT_FILE_PATH, { force: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createClient(supabaseUrl, supabaseServiceRole, {
    realtime: { transport: ws as any },
  });

  console.log('=== Supabase データベース統計情報 ===\n');

  try {
    // データベースから動的にテーブル一覧を取得
    console.log('🔍 テーブル一覧を取得中...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables = await getAllTables(client as any);

    if (tables.length === 0) {
      console.log('⚠️  テーブルが見つかりませんでした。');
      return;
    }

    console.log(`📋 検出されたテーブル数: ${tables.length}\n`);
    console.log('📈 各テーブルのレコード数:');
    const tableCounts: Record<string, number> = {};
    let totalRecords = 0;

    for (const table of tables) {
      try {
        const { count, error } = await client
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (error) {
          console.log(`  ${table}: エラー (${error.message})`);
          tableCounts[table] = 0;
        } else {
          const recordCount = count || 0;
          tableCounts[table] = recordCount;
          totalRecords += recordCount;
          console.log(`  ${table}: ${recordCount.toLocaleString()} レコード`);
        }
      } catch {
        console.log(`  ${table}: エラー (テーブルが存在しない可能性があります)`);
        tableCounts[table] = 0;
      }
    }

    console.log(`\n📊 合計レコード数: ${totalRecords.toLocaleString()}（参考・課金非連動）`);

    // 容量情報を取得（RPC関数を使用）
    console.log('\n💾 データベース容量情報:');
    const { databaseSize, tableSizes } = await getDatabaseSizes(client);

    if (databaseSize) {
      console.log(`  📦 データベース全体のサイズ: ${databaseSize.database_size_pretty}`);
      console.log(`     (${formatBytesAsMb(databaseSize.database_size_bytes)} MB)`);
    } else {
      console.log('  ⚠️  データベースサイズ情報が取得できませんでした。');
    }

    if (tableSizes.length > 0) {
      console.log('\n  📋 テーブルごとのサイズ:');
      for (const tableSize of tableSizes) {
        const recordCount = tableCounts[tableSize.table_name] || 0;
        const avgSizePerRecord =
          recordCount > 0 ? (tableSize.size_bytes / recordCount / 1024).toFixed(2) : 'N/A';
        console.log(
          `    ${tableSize.table_name}: ${tableSize.size_pretty} (${recordCount.toLocaleString()} レコード, 平均 ${avgSizePerRecord} KB/レコード)`
        );
      }

      const totalSizeBytes = tableSizes.reduce((sum, t) => sum + t.size_bytes, 0);
      console.log(`\n  📊 テーブル合計サイズ: ${formatBytesAsMb(totalSizeBytes)} MB`);
    } else {
      console.log('  ⚠️  テーブルサイズ情報が取得できませんでした。');
    }

    const databaseSizeBytes = databaseSize?.database_size_bytes ?? 0;
    printTableDiskShareWarnings(tableSizes, databaseSize?.database_size_bytes ?? null);
    printProPlanQuotaAndRecommendations(databaseSize?.database_size_bytes ?? null);

    // 内訳が取れなくても、DB 容量の統計と比較用スナップショットは残す
    const dailyRowsByUser: NonNullable<DbStatsSnapshot['dailyRowsByUser']> = {};
    const failedUserCounts: Partial<Record<DailyRowBreakdownKey, number>> = {};
    let nameById = new Map<string, string | null>();
    try {
      nameById = await loadUserNames(client);
    } catch (error) {
      console.error('ユーザー別内訳の氏名取得に失敗しました。氏名は「未設定」で集計を続けます:', error);
    }
    for (const breakdown of DAILY_ROW_BREAKDOWNS) {
      const previousStats = previousSnapshot?.dailyRowsByUser?.[breakdown.key];
      try {
        const result = await collectDailyRowsByUser(client, breakdown, nameById);
        dailyRowsByUser[breakdown.key] = result.stats;
        failedUserCounts[breakdown.key] = result.failedUserCount;
        printDailyRowsByUser(breakdown, result.stats, result.failedUserCount, previousStats);
      } catch (error) {
        console.error(`${breakdown.label}の行数（ユーザー別）の集計に失敗しました:`, error);
      }
    }

    const currentSnapshot =
      databaseSizeBytes > 0 && tableSizes.length > 0
        ? buildSnapshot(databaseSizeBytes, tableSizes, tableCounts, dailyRowsByUser)
        : null;

    if (currentSnapshot) {
      printDeltaFromPrevious(currentSnapshot, previousSnapshot);
      writeFileSync(
        REPORT_FILE_PATH,
        `${JSON.stringify(buildReport(currentSnapshot, previousSnapshot, tableSizes, failedUserCounts), null, 2)}\n`,
        'utf-8'
      );
      saveSnapshot(currentSnapshot);
      console.log(`\n💾 比較用スナップショットを保存しました: ${HISTORY_FILE_PATH}`);
    }
  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error; // エラーを再throwしてスクリプトを失敗させる
  }
}

// スクリプト実行
checkDatabaseStats()
  .then(() => {
    console.log('\n✅ 統計情報の取得が完了しました');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ エラー:', error);
    process.exit(1);
  });
