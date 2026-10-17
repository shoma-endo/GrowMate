'use strict';

/**
 * 毎日の自動取込（GSC・GA4・WordPress）の失敗を、運営向けに Lark へ送る（docs/specs/auto-daily-imports-spec.md FR-013）。
 * cron は利用者ごとの失敗でも HTTP 200 を返すので、Vercel の表示だけでは気づけない。
 * cron_run_logs と各連携の自動取込の結果を読み、問題があった日だけ送る。
 *
 * 使い方: node scripts/notify-daily-import-failures.cjs [--dry-run]
 *   --dry-run: 送信せずカードを標準出力に出す
 * 環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE, LARK_WEBHOOK_URL（--dry-run では不要）
 */

const { createClient } = require('@supabase/supabase-js');
const { escapeLarkMd, sendLarkCard, div, hr, note, table } = require('./lark-notify.cjs');

// その日の定時実行（04:05〜）より前の JST 04:00 から見る。直近24時間にすると、前日の手動実行が
// 残っていて、今朝の定時実行が起動しなかったことを見逃す
const DAY_START_HOUR_JST = 4;
const PAID_FEATURE_ROLES = ['paid', 'admin'];
const DAILY_CRONS = [
  { name: 'gsc_daily_import', label: 'GSC 日次取込（04:05）' },
  { name: 'ga4_daily_sync', label: 'GA4 日次同期（04:25）' },
  { name: 'wordpress_daily_import', label: 'WordPress 差分取込（04:45）' },
];
const FAILURE_EVENTS = ['batch_failed', 'route_failed', 'route_timed_out', 'batch_time_budget_exceeded'];
const STATUS_LABELS = {
  auth_expired: '認証切れ（マイホームに再連携カード）',
  temporary_failure: '一時的な失敗（3日以上ならマイホームにカード）',
  permission_denied: 'プロパティの権限切れ（マイホームにカード）',
};

const formatJst = iso =>
  iso
    ? new Date(iso).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** 直近の JST 04:00（UTC 19:00） */
function dayStart(now) {
  const start = new Date(now);
  start.setUTCHours(DAY_START_HOUR_JST - 9 + 24, 0, 0, 0);
  if (start > now) start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

/**
 * 各 cron のその日の最後の回を見て、問題を返す（無ければ null）。
 * severe は取込そのものが止まった（起動していない・強制終了・route の失敗）か、未処理の利用者が残った。
 * 利用者ごとの失敗だけなら false。
 * 上限：手動実行が定時実行と重なると、前の回の完了を後の回のものとして数える。05:30 には定時実行しか無いので許容する
 */
function describeCronRun(logs, cron) {
  const own = logs.filter(log => log.cron_name === cron.name);
  const started = own.filter(log => log.event === 'batch_started').at(-1);
  if (!started) return { severe: true, text: `${cron.label}：今日は起動していません` };
  const after = own.slice(own.lastIndexOf(started));
  const failure = after.find(log => FAILURE_EVENTS.includes(log.event));
  if (failure) return { severe: true, text: `${cron.label}：${failure.event}（${formatJst(failure.logged_at)}）` };
  const completed = after.find(log => log.event === 'batch_completed');
  if (!completed) {
    return {
      severe: true,
      text: `${cron.label}：${formatJst(started.logged_at)} に起動したが、完了の記録がありません（強制終了の可能性）`,
    };
  }
  const { total = 0, failed = 0, remaining = 0 } = completed.details ?? {};
  if (failed > 0 || remaining > 0) {
    return {
      severe: remaining > 0,
      text: `${cron.label}：${total}人中 失敗 ${failed}人・未処理 ${remaining}人（${formatJst(completed.logged_at)}）`,
    };
  }
  return null;
}

async function collect(supabase) {
  const since = dayStart(new Date()).toISOString();
  // 開発と本番は同じ Supabase なので、ローカルから cron を呼んだ記録を混ぜない
  const { data: logs, error: logError } = await supabase
    .from('cron_run_logs')
    .select('cron_name, event, details, logged_at')
    .eq('environment', 'production')
    .in('cron_name', DAILY_CRONS.map(cron => cron.name))
    .gte('logged_at', since)
    .order('logged_at', { ascending: true });
  if (logError) throw new Error(`cron_run_logs の取得に失敗しました: ${logError.message}`);

  const { data: wordpress, error: wpError } = await supabase
    .from('wordpress_settings')
    .select('user_id, wp_auto_import_status, wp_auto_import_status_at, users!inner(full_name, role)')
    .in('wp_auto_import_status', ['auth_expired', 'temporary_failure'])
    .in('users.role', PAID_FEATURE_ROLES);
  if (wpError) throw new Error(`wordpress_settings の取得に失敗しました: ${wpError.message}`);

  const { data: google, error: googleError } = await supabase
    .from('gsc_credentials')
    .select(
      'user_id, gsc_auto_import_status, gsc_auto_import_status_at, ga4_auto_import_status, ga4_auto_import_status_at, users!inner(full_name, role)'
    )
    .or('gsc_auto_import_status.eq.permission_denied,ga4_auto_import_status.eq.permission_denied')
    .in('users.role', PAID_FEATURE_ROLES);
  if (googleError) throw new Error(`gsc_credentials の取得に失敗しました: ${googleError.message}`);

  const nameOf = row => (Array.isArray(row.users) ? row.users[0]?.full_name : row.users?.full_name) ?? row.user_id;
  const users = [];
  for (const row of wordpress ?? []) {
    users.push({ source: 'WordPress', name: nameOf(row), status: row.wp_auto_import_status, at: row.wp_auto_import_status_at });
  }
  for (const row of google ?? []) {
    if (row.gsc_auto_import_status === 'permission_denied') {
      users.push({ source: 'GSC', name: nameOf(row), status: 'permission_denied', at: row.gsc_auto_import_status_at });
    }
    if (row.ga4_auto_import_status === 'permission_denied') {
      users.push({ source: 'GA4', name: nameOf(row), status: 'permission_denied', at: row.ga4_auto_import_status_at });
    }
  }

  const cronIssues = DAILY_CRONS.map(cron => describeCronRun(logs ?? [], cron)).filter(Boolean);
  return { cronIssues, users };
}

function buildElements({ cronIssues, users }) {
  const elements = [];
  if (cronIssues.length > 0) {
    elements.push(div(`**取込の実行**\n${cronIssues.map(issue => `・${escapeLarkMd(issue.text)}`).join('\n')}`));
  } else {
    elements.push(div('**取込の実行**\n・3本とも最後まで完了し、未処理の利用者はいません'));
  }
  if (users.length > 0) {
    elements.push(hr());
    elements.push(div(`**止まっている利用者（${users.length}件）**`));
    elements.push(
      table(
        [
          { name: 'source', display_name: '取込元', data_type: 'text' },
          { name: 'name', display_name: '氏名', data_type: 'text' },
          { name: 'status', display_name: '状態', data_type: 'text' },
          { name: 'at', display_name: '記録（JST）', data_type: 'text' },
        ],
        users.map(user => ({
          source: user.source,
          name: user.name,
          status: STATUS_LABELS[user.status] ?? user.status,
          at: formatJst(user.at),
        }))
      )
    );
  }
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  elements.push(
    note(
      `今日（JST 04:00 以降）の cron_run_logs と各連携の自動取込の結果から集計。Google のトークン失効は結果を記録していないので一覧に出ない（マイホームには再連携カードが出る）。利用者ごとの理由は Vercel のログ（1日で消える）を参照${runUrl ? ` ・ [実行ログ](${runUrl})` : ''}`
    )
  );
  return elements;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
  if (!supabaseUrl || !serviceRole) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE が設定されていません');

  const report = await collect(createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } }));
  if (report.cronIssues.length === 0 && report.users.length === 0) {
    console.log('問題なし。通知は送りません');
    return;
  }
  const title = `日次取込の確認が必要です（${formatJst(new Date().toISOString())}）`;
  const template = report.cronIssues.some(issue => issue.severe) ? 'red' : 'orange';
  const elements = buildElements(report);
  if (dryRun) {
    console.log(JSON.stringify({ title, template, elements }, null, 2));
    return;
  }
  await sendLarkCard({ webhookUrl: process.env.LARK_WEBHOOK_URL, title, template, elements });
}

main().catch(async error => {
  console.error('[notify-daily-import-failures]', error);
  // 集計そのものが失敗した日も黙らない（気づけないのを防ぐのがこの通知の目的のため）
  if (!process.argv.includes('--dry-run') && process.env.LARK_WEBHOOK_URL) {
    await sendLarkCard({
      webhookUrl: process.env.LARK_WEBHOOK_URL,
      title: '日次取込の失敗チェックが動きませんでした',
      template: 'red',
      elements: [div(escapeLarkMd(error instanceof Error ? error.message : String(error)))],
    }).catch(sendError => console.error('[notify-daily-import-failures] Lark send failed', sendError));
  }
  process.exit(1);
});
