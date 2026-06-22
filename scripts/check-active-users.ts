import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import ws from 'ws';

interface ActiveUserData {
  氏名: string | null;
  最終ログイン日時: string | null;
  WordPressサイトURL: string | null;
  When: string | null;
  Where: string | null;
  Who: string | null;
  Why: string | null;
  What: string | null;
  How: string | null;
  Price: string | null;
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
 * 日付をJST形式でフォーマット
 */
function formatDateJST(date: Date | string | null): string {
  if (!date) return '未設定';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * lark_md の Markdown特殊文字（*, _, ~, `, [, <）の直後にゼロ幅スペースを挿入し、
 * ユーザー入力由来の値（氏名・事業者情報）がMarkdown/メンション記法として
 * 解釈されないようにする。表示上の見た目は変化しない。
 */
function escapeLarkMd(value: string): string {
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  return value.replace(/[*_~`[<]/g, char => `${char}${ZERO_WIDTH_SPACE}`);
}

/**
 * 1ユーザー1ブロック形式でデータを整形
 *
 * 固定幅の等幅テーブル（padEnd揃え）は、Lark interactiveカード（lark_md）が
 * フェンスコードブロック（```）を等幅表示しないため、プロポーショナルフォント上で
 * 列がずれて読めなくなる。そのためキー:値形式の縦並びに変更している。
 */
function formatTable(data: ActiveUserData[]): string {
  if (data.length === 0) {
    return 'アクティブユーザーが見つかりませんでした。';
  }

  const truncate = (value: string | null, maxLength = 60): string => {
    if (!value) return '未設定';
    const truncated = value.length > maxLength ? `${value.substring(0, maxLength - 3)}...` : value;
    return escapeLarkMd(truncated);
  };

  return data
    .map((row, i) => {
      return [
        `${i + 1}. **${escapeLarkMd(row.氏名 || '未設定')}**（最終ログイン: ${row.最終ログイン日時 || '未設定'}）`,
        `   URL: ${truncate(row.WordPressサイトURL)}`,
        `   When: ${truncate(row.When)} / Where: ${truncate(row.Where)}`,
        `   Who: ${truncate(row.Who)}`,
        `   Why: ${truncate(row.Why)}`,
        `   What: ${truncate(row.What)}`,
        `   How: ${truncate(row.How)} / Price: ${truncate(row.Price)}`,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * 直近1週間でログインしたアクティブユーザーの情報を取得
 */
async function checkActiveUsers() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRole = env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !supabaseServiceRole) {
    throw new Error('環境変数が設定されていません。.env.localファイルを確認してください。');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createClient(supabaseUrl, supabaseServiceRole, {
    realtime: { transport: ws as any },
  });

  console.log('=== アクティブユーザー情報（直近1週間） ===\n');

  try {
    // 7日前の日時を計算（JST基準）
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    console.log(`📅 集計期間: ${formatDateJST(sevenDaysAgo)} 以降\n`);

    // ユーザー情報を取得
    const { data: users, error: usersError } = await client
      .from('users')
      .select('id, full_name, last_login_at')
      .gte('last_login_at', sevenDaysAgoISO)
      .order('last_login_at', { ascending: false });

    if (usersError) {
      throw new Error(`ユーザー情報の取得に失敗しました: ${usersError.message}`);
    }

    if (!users || users.length === 0) {
      console.log('アクティブユーザーが見つかりませんでした。');
      return;
    }

    // 除外するユーザー名のリスト
    const excludedNames = ['遠藤 匠馬'];

    // 特定のユーザーを除外
    const filteredUsers = users.filter(user => !excludedNames.includes(user.full_name || ''));

    if (filteredUsers.length === 0) {
      console.log('フィルタリング後のアクティブユーザーが見つかりませんでした。');
      return;
    }

    console.log(
      `📊 アクティブユーザー数: ${filteredUsers.length}人（除外: ${users.length - filteredUsers.length}人）\n`
    );

    // ユーザーIDのリストを取得（UUID型）
    const userIds = filteredUsers.map(u => u.id);

    // wordpress_settingsを一括取得（user_idはUUID型）
    const { data: wpSettingsData, error: wpSettingsError } = await client
      .from('wordpress_settings')
      .select('user_id, wp_site_url')
      .in('user_id', userIds);

    if (wpSettingsError) {
      throw new Error(`WordPress設定情報の取得に失敗しました: ${wpSettingsError.message}`);
    }

    // briefsを一括取得（user_idはTEXT型なので、UUIDを文字列に変換して比較）
    const userIdsAsText = userIds.map(id => String(id));
    const { data: briefsData, error: briefsError } = await client
      .from('briefs')
      .select('user_id, data')
      .in('user_id', userIdsAsText);

    if (briefsError) {
      throw new Error(`事業者情報の取得に失敗しました: ${briefsError.message}`);
    }

    // マップを作成（高速検索用）
    const wpSettingsMap = new Map(
      (wpSettingsData || []).map(ws => [String(ws.user_id), ws.wp_site_url])
    );
    const briefsMap = new Map((briefsData || []).map(b => [String(b.user_id), b.data]));

    // データを整形
    const activeUserData: ActiveUserData[] = filteredUsers.map(
      (user: { id: string; full_name: string | null; last_login_at: string | null }) => {
        const userIdStr = String(user.id);
        const wpSiteUrl = wpSettingsMap.get(userIdStr) || null;
        const briefData = briefsMap.get(userIdStr) || {};

        // briefsのdataから5W2Hを抽出（新形式: services[0] を優先）
        const services = Array.isArray((briefData as { services?: unknown }).services)
          ? ((briefData as { services?: unknown }).services as unknown[])
          : [];
        const firstService = services[0] as Record<string, unknown> | undefined;

        const extract5W2H = (key: string) => {
          const serviceValue = firstService?.[key];
          if (serviceValue && typeof serviceValue === 'string') {
            return serviceValue;
          }
          const legacyValue = (briefData as Record<string, unknown>)[key];
          return legacyValue && typeof legacyValue === 'string' ? legacyValue : null;
        };

        return {
          氏名: user.full_name || '未設定',
          最終ログイン日時: formatDateJST(user.last_login_at),
          WordPressサイトURL: wpSiteUrl || '未設定',
          When: extract5W2H('when'),
          Where: extract5W2H('where'),
          Who: extract5W2H('who'),
          Why: extract5W2H('why'),
          What: extract5W2H('what'),
          How: extract5W2H('how'),
          Price: extract5W2H('price'),
        };
      }
    );

    // テーブル形式で出力
    const tableOutput = formatTable(activeUserData);
    console.log(tableOutput);
  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error;
  }
}

// スクリプト実行
checkActiveUsers()
  .then(() => {
    console.log('\n✅ アクティブユーザー情報の取得が完了しました');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ エラー:', error);
    process.exit(1);
  });
