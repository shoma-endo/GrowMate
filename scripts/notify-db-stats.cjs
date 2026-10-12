'use strict';

/**
 * db-stats-weekly ワークフローの Lark 通知。
 * check-db-stats.ts が書いた db-stats-report.json からグラフ・表のカードを組み立てて送る。
 * 集計が失敗した、またはレポートが無いときは全文テキストだけのカードにする。
 *
 * 使い方: node scripts/notify-db-stats.cjs [--dry-run]
 *   --dry-run: 送信せずカードの elements を標準出力に出す
 */

const fs = require('fs');
const path = require('path');
const { escapeLarkMd, sendLarkCard, div, hr, note, chart, table } = require('./lark-notify.cjs');

const REPORT_FILE_PATH = path.join(__dirname, 'db-stats-report.json');
const OUTPUT_FILE_PATH = 'db-stats-output.txt';
const TABLE_CHART_LIMIT = 8;
const USER_CHART_LIMIT = 10;

const toMb = bytes => Math.round((bytes / 1024 / 1024) * 10) / 10;
const toGb = bytes => (bytes / 1024 / 1024 / 1024).toFixed(2);
const formatJstDate = iso =>
  new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
const formatSigned = (value, digits = 0) =>
  `${value >= 0 ? '+' : ''}${value.toLocaleString('ja-JP', { maximumFractionDigits: digits })}`;

function readOptional(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.warn(`Failed to read ${filePath}:`, error.message);
    return null;
  }
}

/**
 * 今回と前回を並べた横棒グラフ。前回の値が無い項目は今回だけを出す。
 * 前回は通常1週間前だが、手動実行を挟むとその日になるため「先週」とは書かない
 */
function comparisonBarChart({ title, unit, items, periodLabels }) {
  const values = [];
  for (const item of items) {
    if (item.previous !== null) {
      values.push({ label: item.label, period: periodLabels.previous, value: item.previous });
    }
    values.push({ label: item.label, period: periodLabels.current, value: item.current });
  }
  return chart(
    {
      type: 'bar',
      direction: 'horizontal',
      title: { text: title },
      data: [{ id: 'values', values }],
      xField: 'value',
      yField: ['label', 'period'],
      seriesField: 'period',
      legends: { visible: true, orient: 'bottom' },
      label: { visible: true },
      axes: [
        { orient: 'bottom', title: { visible: true, text: unit } },
        { orient: 'left', label: { visible: true } },
      ],
    },
    { aspectRatio: '4:3' }
  );
}

function buildSummary(report) {
  const usagePercent = (report.databaseSizeBytes / report.diskQuotaBytes) * 100;
  const lines = [
    `**DB全体** ${toGb(report.databaseSizeBytes)} GB / ${toGb(report.diskQuotaBytes)} GB（${usagePercent.toFixed(1)}%）`,
  ];

  if (report.previousDatabaseSizeBytes === null) {
    lines.push('前回比: 比較データなし');
  } else {
    const deltaMb = toMb(report.databaseSizeBytes - report.previousDatabaseSizeBytes);
    lines.push(`前回比（${formatJstDate(report.previousCapturedAt)}）: ${formatSigned(deltaMb, 1)} MB`);
  }

  if (report.diskGrowthWarning) {
    lines.push('⚠️ DB全体の増加率が閾値を超えています');
  }
  for (const warning of report.shareWarnings) {
    lines.push(
      `${warning.critical ? '🔴' : '⚠️'} ${escapeLarkMd(warning.name)} がDB全体の ${warning.sharePercent.toFixed(1)}%（${warning.critical ? '要対処' : '要監視'}）`
    );
  }
  for (const growth of report.growthWarnings.slice(0, 5)) {
    lines.push(
      `⚠️ 急増: ${escapeLarkMd(growth.name)} ${formatSigned(toMb(growth.deltaBytes), 1)} MB（${formatSigned(growth.deltaPercent, 1)}%）`
    );
  }
  return div(lines.join('\n'));
}

/** グラフは label で棒をまとめるため、同名（「未設定」を含む）に連番を付けて分ける */
function uniqueLabels(names) {
  const seen = new Map();
  return names.map(name => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

function buildGscQueryTable(report) {
  const withData = report.gscQueryByUser.filter(user => user.daysWithData > 0);
  const numberColumn = (name, displayName) => ({
    name,
    display_name: displayName,
    data_type: 'number',
    format: { precision: 0, separator: true },
  });
  return table(
    [
      { name: 'name', display_name: '氏名', data_type: 'text', width: 'auto' },
      numberColumn('avg', '1日平均'),
      numberColumn('sd', '標準偏差'),
      numberColumn('max', '最大'),
      { name: 'delta', display_name: '前回比', data_type: 'text' },
      numberColumn('days', '日数'),
    ],
    withData.map(user => ({
      name: user.name,
      avg: Math.round(user.avgPerDay),
      sd: Math.round(user.sdPerDay),
      max: user.maxPerDay,
      delta:
        user.previousAvgPerDay === null
          ? '—'
          : formatSigned(Math.round(user.avgPerDay - user.previousAvgPerDay)),
      days: user.daysWithData,
    }))
  );
}

function buildReportElements(report) {
  const usersWithData = report.gscQueryByUser.filter(user => user.daysWithData > 0);
  const noDataCount = report.gscQueryByUser.length - usersWithData.length;
  const gscNotes = [
    `直近${report.gscQueryWindowDays}日のうちデータがある日だけの、gsc_query_metrics の1日あたり行数`,
    `データなし: ${noDataCount}人`,
  ];
  if (report.gscQueryFailedUserCount > 0) {
    gscNotes.push(`⚠️ 集計に失敗: ${report.gscQueryFailedUserCount}人（実行ログを確認）`);
  }
  const userLabels = uniqueLabels(usersWithData.map(user => user.name));

  const periodLabels = {
    current: `今回 ${formatJstDate(report.capturedAt)}`,
    previous: report.previousCapturedAt ? `前回 ${formatJstDate(report.previousCapturedAt)}` : '前回',
  };
  const elements = [
    buildSummary(report),
    hr(),
    comparisonBarChart({
      periodLabels,
      title: `テーブル別サイズ 上位${TABLE_CHART_LIMIT}`,
      unit: 'MB',
      items: report.tables.slice(0, TABLE_CHART_LIMIT).map(item => ({
        label: item.name,
        current: toMb(item.sizeBytes),
        previous: item.previousSizeBytes === null ? null : toMb(item.previousSizeBytes),
      })),
    }),
    hr(),
    div('**🔎 GSCクエリ行数（ユーザー別）**'),
  ];

  if (report.gscQueryFailedUserCount === null) {
    elements.push(div('⚠️ 集計に失敗しました（実行ログを確認）'));
    return elements;
  }
  if (usersWithData.length > 0) {
    elements.push(
      comparisonBarChart({
        periodLabels,
        title: `1日平均行数 上位${USER_CHART_LIMIT}人`,
        unit: '行/日',
        items: usersWithData.slice(0, USER_CHART_LIMIT).map((user, index) => ({
          label: userLabels[index],
          current: Math.round(user.avgPerDay),
          previous: user.previousAvgPerDay === null ? null : Math.round(user.previousAvgPerDay),
        })),
      }),
      buildGscQueryTable(report)
    );
  } else {
    elements.push(div('対象期間にデータのあるユーザーはいません'));
  }
  elements.push(note(gscNotes.join('\n')));
  return elements;
}

function buildElements({ report, output, isSuccess, workflowUrl }) {
  const statusLine = div(`**${isSuccess ? '✅ 成功' : '❌ 失敗'}**`);
  const fullText = div(`**📊 統計情報（全文）**\n\`\`\`\n${escapeLarkMd(output)}\n\`\`\``);
  const logLink = note(`[実行ログを見る](${workflowUrl})`);

  if (!report) {
    return [statusLine, hr(), fullText, hr(), logLink];
  }
  return [...buildReportElements(report), hr(), fullText, hr(), logLink];
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const isSuccess = process.env.STATUS === 'success';
  const output = readOptional(OUTPUT_FILE_PATH) ?? 'Output file not available';
  const reportRaw = readOptional(REPORT_FILE_PATH);
  let report = null;
  if (reportRaw !== null) {
    try {
      report = JSON.parse(reportRaw);
    } catch (error) {
      console.error('db-stats-report.json の解析に失敗しました。全文テキストのみで送信します:', error.message);
    }
  }

  const workflowUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const richReport = isSuccess ? report : null;
  const elements = buildElements({ report: richReport, output, isSuccess, workflowUrl });
  const title = `📊 データベース統計レポート：${isSuccess ? '成功' : '失敗'}`;

  if (dryRun) {
    console.log(JSON.stringify({ title, elements }, null, 2));
    return;
  }

  const send = cardElements =>
    sendLarkCard({
      webhookUrl: process.env.DB_STATS_WEBHOOK_URL,
      title,
      template: isSuccess ? 'green' : 'red',
      elements: cardElements,
    });

  send(elements)
    .catch(error => {
      if (!richReport) {
        throw error;
      }
      // グラフ・表の部品が受け付けられなかった週も、全文テキストだけは届ける
      console.error('グラフ付きカードの送信に失敗しました。全文テキストのみで再送します:', error.message);
      return send(buildElements({ report: null, output, isSuccess, workflowUrl })).then(() => {
        process.exitCode = 1;
      });
    })
    .then(() => process.exit(process.exitCode ?? 0))
    .catch(error => {
      console.error('ERROR:', error.message);
      process.exit(1);
    });
}

main();
