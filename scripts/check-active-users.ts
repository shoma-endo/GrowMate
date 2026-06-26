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

interface ActiveUserRecord {
  id: string;
  full_name: string | null;
  last_login_at: string | null;
  email: string | null;
  supabase_auth_id: string | null;
  line_user_id: string | null;
}

interface DeduplicatedActiveUser extends ActiveUserRecord {
  sourceIds: string[];
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

function normalizeIdentifier(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function getDeduplicationKeys(user: ActiveUserRecord): string[] {
  const identifierFields: Array<[string, string | null]> = [
    ['email', user.email],
    ['supabase_auth_id', user.supabase_auth_id],
    ['line_user_id', user.line_user_id],
    ['full_name', user.full_name],
  ];
  const keys = identifierFields.flatMap(([prefix, value]) => {
    const normalized = normalizeIdentifier(value);
    return normalized ? [`${prefix}:${normalized}`] : [];
  });

  return keys.length > 0 ? keys : [`id:${user.id}`];
}

function isAfter(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}

function deduplicateUsers(users: ActiveUserRecord[]): DeduplicatedActiveUser[] {
  const groups = new Map<number, DeduplicatedActiveUser>();
  const keyToGroupId = new Map<string, number>();
  let nextGroupId = 1;

  const applyRepresentative = (group: DeduplicatedActiveUser, user: ActiveUserRecord) => {
    const { sourceIds } = group;
    Object.assign(group, { ...user, sourceIds });
  };

  for (const user of users) {
    const keys = getDeduplicationKeys(user);
    const matchedGroupIds = Array.from(
      new Set(keys.flatMap(key => keyToGroupId.get(key) ?? []))
    );

    if (matchedGroupIds.length === 0) {
      const groupId = nextGroupId;
      nextGroupId += 1;
      groups.set(groupId, { ...user, sourceIds: [user.id] });
      keys.forEach(key => keyToGroupId.set(key, groupId));
      continue;
    }

    const primaryGroupId = matchedGroupIds[0];
    if (primaryGroupId === undefined) {
      throw new Error('アクティブユーザーの重複排除に失敗しました。');
    }
    const primaryGroup = groups.get(primaryGroupId);
    if (!primaryGroup) {
      throw new Error('アクティブユーザーの重複排除に失敗しました。');
    }

    for (const groupId of matchedGroupIds.slice(1)) {
      const group = groups.get(groupId);
      if (!group) continue;

      primaryGroup.sourceIds.push(...group.sourceIds);
      if (isAfter(group.last_login_at, primaryGroup.last_login_at)) {
        applyRepresentative(primaryGroup, group);
      }

      for (const [key, mappedGroupId] of keyToGroupId.entries()) {
        if (mappedGroupId === groupId) {
          keyToGroupId.set(key, primaryGroupId);
        }
      }
      groups.delete(groupId);
    }

    primaryGroup.sourceIds.push(user.id);
    if (isAfter(user.last_login_at, primaryGroup.last_login_at)) {
      applyRepresentative(primaryGroup, user);
    }
    keys.forEach(key => keyToGroupId.set(key, primaryGroupId));
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    sourceIds: Array.from(new Set(group.sourceIds)),
  })).sort((a, b) => {
    const aTime = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
    const bTime = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
    return bTime - aTime;
  });
}

function findBySourceId<T>(sourceIds: string[], map: Map<string, T>): T | null {
  for (const sourceId of sourceIds) {
    if (map.has(sourceId)) {
      return map.get(sourceId) ?? null;
    }
  }

  return null;
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
      .select('id, full_name, last_login_at, email, supabase_auth_id, line_user_id')
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
    const deduplicatedUsers = deduplicateUsers(filteredUsers);

    if (deduplicatedUsers.length === 0) {
      console.log('フィルタリング後のアクティブユーザーが見つかりませんでした。');
      return;
    }

    const excludedCount = users.length - filteredUsers.length;
    const deduplicatedCount = filteredUsers.length - deduplicatedUsers.length;
    console.log(
      `📊 アクティブユーザー数: ${deduplicatedUsers.length}人（除外: ${excludedCount}人 / 重複除外: ${deduplicatedCount}人）\n`
    );

    // ユーザーIDのリストを取得（UUID型）
    const userIds = Array.from(new Set(deduplicatedUsers.flatMap(u => u.sourceIds)));

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
    const activeUserData: ActiveUserData[] = deduplicatedUsers.map(user => {
      const sourceIds = user.sourceIds.map(id => String(id));
      const wpSiteUrl = findBySourceId(sourceIds, wpSettingsMap);
      const briefData = findBySourceId(sourceIds, briefsMap) || {};

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
    });

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
