import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import ws from 'ws';

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

interface DbStatsSnapshot {
  capturedAt: string;
  databaseSizeBytes: number;
  tables: Record<string, TableSnapshot>;
}

/** Supabase Pro プランの含まれるクォータ（https://supabase.com/pricing 参照） */
const SUPABASE_PRO_PLAN = {
  diskSizeBytes: 8 * 1024 * 1024 * 1024,
  monthlyActiveUsers: 100_000,
  fileStorageBytes: 100 * 1024 * 1024 * 1024,
  egressBytes: 250 * 1024 * 1024 * 1024,
} as const;

const HISTORY_FILE_PATH = join(__dirname, 'db-stats-history.json');

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
  tableCounts: Record<string, number>
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
  };
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

  const warnings = [...tableSizes]
    .map(table => ({
      ...table,
      sharePercent: (table.size_bytes / databaseSizeBytes) * 100,
    }))
    .filter(table => table.sharePercent >= TABLE_DISK_SHARE_WARN_PERCENT)
    .sort((a, b) => b.size_bytes - a.size_bytes);

  if (warnings.length === 0) {
    console.log('  ✅ 単一テーブルの占有率が高いボトルネックは検出されませんでした。');
    return;
  }

  for (const table of warnings) {
    const isCritical = table.sharePercent >= TABLE_DISK_SHARE_CRITICAL_PERCENT;
    const icon = isCritical ? '🔴' : '⚠️';
    const level = isCritical ? '要対処' : '要監視';
    console.log(
      `  ${icon} ${table.table_name}: ${formatBytesAsMb(table.size_bytes)} MB（DB全体の ${table.sharePercent.toFixed(1)}%）— ${level}`
    );
  }
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
  const deltaMb = deltaBytes / 1024 / 1024;
  const deltaPercent =
    previous.databaseSizeBytes > 0 ? (deltaBytes / previous.databaseSizeBytes) * 100 : 0;

  console.log(
    `  📦 DB全体: ${formatSignedMb(deltaBytes)} MB (${formatSignedPercent(deltaPercent)}%)`
  );

  if (
    deltaMb >= DISK_GROWTH_WARN_MB ||
    (previous.databaseSizeBytes > 0 && deltaPercent >= DISK_GROWTH_WARN_PERCENT)
  ) {
    console.log('  ⚠️  DB全体の増加率が閾値を超えています。データ肥大化を確認してください。');
  } else if (deltaBytes <= 0) {
    console.log('  ✅ DB全体のサイズは前回から増加していません。');
  } else {
    console.log('  ✅ DB全体の増加は閾値内です。');
  }

  const tableGrowthWarnBytes = TABLE_GROWTH_WARN_MB * 1024 * 1024;
  const tableGrowthMinBytes = TABLE_GROWTH_MIN_MB * 1024 * 1024;
  const tableDeltas = Object.entries(current.tables)
    .map(([name, currentTable]) => {
      const previousTable = previous.tables[name];
      if (!previousTable) {
        return null;
      }
      const tableDeltaBytes = currentTable.sizeBytes - previousTable.sizeBytes;
      if (tableDeltaBytes === 0) {
        return null;
      }
      const tableDeltaPercent =
        previousTable.sizeBytes > 0
          ? (tableDeltaBytes / previousTable.sizeBytes) * 100
          : 0;
      return { name, tableDeltaBytes, tableDeltaPercent };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.tableDeltaBytes - a.tableDeltaBytes);

  const significantGrowth = tableDeltas.filter(
    row =>
      row.tableDeltaBytes >= tableGrowthWarnBytes ||
      (row.tableDeltaPercent >= TABLE_GROWTH_WARN_PERCENT &&
        row.tableDeltaBytes >= tableGrowthMinBytes)
  );

  if (significantGrowth.length > 0) {
    console.log('  急増テーブル:');
    for (const row of significantGrowth.slice(0, 5)) {
      console.log(
        `    ⚠️  ${row.name}: ${formatSignedMb(row.tableDeltaBytes)} MB (${formatSignedPercent(row.tableDeltaPercent)}%)`
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

// .env.localファイルから環境変数を読み込む
function loadEnv() {
  try {
    const envPath = join(__dirname, '../.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};

    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts
            .join('=')
            .trim()
            .replace(/^["']|["']$/g, '');
        }
      }
    }

    return env;
  } catch (error) {
    console.error('環境変数の読み込みエラー:', error);
    return {};
  }
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

    const currentSnapshot =
      databaseSizeBytes > 0 && tableSizes.length > 0
        ? buildSnapshot(databaseSizeBytes, tableSizes, tableCounts)
        : null;

    if (currentSnapshot) {
      printDeltaFromPrevious(currentSnapshot, previousSnapshot);
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
