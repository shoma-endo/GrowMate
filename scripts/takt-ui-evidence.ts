/**
 * TAKT spec-to-pr の ui_evidence step から呼ぶ UI 証跡の採取スクリプト。
 *
 * 決めた画面幅ごとに、対象画面と既存の類似画面を開いて
 * - ページ全体の横はみ出し（documentElement の scrollWidth > clientWidth）
 * - 表のセル（操作列を含む）の中身のはみ出し（scrollWidth > clientWidth）
 * を測り、全画面のスクリーンショットを撮る。結果は --out に ui-evidence.json / ui-evidence.md として書く。
 *
 * 使い方:
 *   npm run takt:ui-evidence -- --out <dir> --pair /app/target=/app/existing [--pair ...] [--base-url http://localhost:3000]
 *
 * --base-url が無ければ、この作業ツリーで next dev を起動して終了時に止める。
 * takt run の作業ツリー（clone）には .env.local が無いため、TAKT_UI_ENV_FILE があればそれを読み込んで next dev に渡す。
 * ログイン状態は TAKT_UI_STORAGE_STATE（未指定なら .takt/ui-evidence/storage-state.json）の
 * Playwright storageState を使う。どちらのファイルも中身（環境変数・セッション cookie）は出力しない。
 *
 * 終了コード: 0 = 対象画面にはみ出しなし / 2 = 対象画面にはみ出しあり / 3 = 採取できない（起動失敗・未ログイン等）。
 * 既存の類似画面のはみ出しは記録するが終了コードには含めない（今回の差分による回帰ではないため）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const VIEWPORTS = [
  { name: 'pc-1280', width: 1280, height: 800 },
  { name: 'pc-1024', width: 1024, height: 768 },
] as const;

const DEFAULT_PORT = 3100;
const DEFAULT_STORAGE_STATE = '.takt/ui-evidence/storage-state.json';
const SERVER_READY_TIMEOUT_MS = 240_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
/** サブピクセルの丸めで 1px 差が出るため、それ以下ははみ出しとみなさない */
const OVERFLOW_TOLERANCE_PX = 1;

const EXIT_OVERFLOW = 2;
const EXIT_CANNOT_CAPTURE = 3;

type Pair = { target: string; compare: string | undefined };

type CellOverflow = {
  table: number;
  row: number;
  column: number;
  header: string;
  text: string;
  scrollWidth: number;
  clientWidth: number;
};

type PageMeasurement = {
  role: 'target' | 'compare';
  path: string;
  viewport: string;
  finalPath: string;
  screenshot: string;
  pageScrollWidth: number;
  pageClientWidth: number;
  pageOverflow: boolean;
  cellOverflows: CellOverflow[];
};

class CannotCaptureError extends Error {}

function parseArgs(argv: string[]): { out: string; pairs: Pair[]; baseUrl: string | undefined } {
  let out: string | undefined;
  let baseUrl: string | undefined;
  const pairs: Pair[] = [];
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new CannotCaptureError(`${flag} に値がありません`);
    }
    index++;
    if (flag === '--out') {
      out = value;
    } else if (flag === '--base-url') {
      baseUrl = value.replace(/\/$/, '');
    } else if (flag === '--pair') {
      // クエリの = と区別するため、比較先は「=/」で分ける
      const separator = value.indexOf('=/');
      const target = separator === -1 ? value : value.slice(0, separator);
      const compare = separator === -1 ? undefined : value.slice(separator + 1);
      if (!target.startsWith('/')) {
        throw new CannotCaptureError(`--pair は /path または /target=/compare の形で指定してください: ${value}`);
      }
      pairs.push({ target, compare });
    } else {
      throw new CannotCaptureError(`不明な引数: ${flag}`);
    }
  }
  if (out === undefined || pairs.length === 0) {
    throw new CannotCaptureError('--out と1つ以上の --pair が必要です');
  }
  return { out, pairs, baseUrl };
}

async function respondsBelow500(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function startDevServer(port: number): Promise<{ baseUrl: string; child: ChildProcess }> {
  const baseUrl = `http://localhost:${port}`;
  if (await respondsBelow500(`${baseUrl}/login`)) {
    throw new CannotCaptureError(`ポート ${port} は既に使われています。別の作業ツリーのサーバーを測らないよう中止します`);
  }
  const child = spawn('npx', ['next', 'dev', '--webpack', '-p', String(port)], {
    env: { ...process.env, WATCHPACK_POLLING: 'true' },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  // 中断・タイムアウトで finally が走らなくても、detached のグループをポートに残さない
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      stopDevServer(child);
      process.exit(EXIT_CANNOT_CAPTURE);
    });
  }
  let stderrTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
  });
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new CannotCaptureError(`next dev が終了しました（exit ${child.exitCode}）: ${stderrTail}`);
    }
    if (await respondsBelow500(`${baseUrl}/login`)) {
      return { baseUrl, child };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  stopDevServer(child);
  throw new CannotCaptureError(`next dev が ${SERVER_READY_TIMEOUT_MS / 1000} 秒以内に応答しませんでした: ${stderrTail}`);
}

function stopDevServer(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // detached で起こしたプロセスグループごと止める。npx が先に終わっても孫の next が残るため、
    // child の終了状態は見ずにグループへ送る
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      console.error('next dev の停止に失敗しました', error);
    }
  }
}

function measure(tolerance: number) {
  const root = document.documentElement;
  const cellOverflows: CellOverflow[] = [];
  document.querySelectorAll('table').forEach((table, tableIndex) => {
    const headers = Array.from(table.tHead?.rows[0]?.cells ?? []).map((th) => th.textContent?.trim() ?? '');
    // table.rows / row.cells は入れ子の表の行・セルを含まない
    Array.from(table.rows).forEach((row, rowIndex) => {
      Array.from(row.cells).forEach((cell, columnIndex) => {
        if (cell.offsetParent === null) return;
        // セル自身を truncate（text-overflow: ellipsis）で省略表示しているのは意図したはみ出し。
        // 子の truncate は自分で overflow: hidden なのでセルの scrollWidth を押し広げず、除外しない
        if (getComputedStyle(cell).textOverflow === 'ellipsis') return;
        if (cell.scrollWidth > cell.clientWidth + tolerance) {
          cellOverflows.push({
            table: tableIndex,
            row: rowIndex,
            column: columnIndex,
            header: headers[columnIndex] ?? '',
            text: (cell.textContent ?? '').trim().slice(0, 40),
            scrollWidth: cell.scrollWidth,
            clientWidth: cell.clientWidth,
          });
        }
      });
    });
  });
  return {
    pageScrollWidth: root.scrollWidth,
    pageClientWidth: root.clientWidth,
    cellOverflows,
  };
}

function slugOf(pagePath: string): string {
  return pagePath.replace(/^\//, '').replace(/[^a-zA-Z0-9-]+/g, '_') || 'root';
}

async function measurePage(
  page: Page,
  baseUrl: string,
  pagePath: string,
  role: PageMeasurement['role'],
  viewport: (typeof VIEWPORTS)[number],
  out: string
): Promise<PageMeasurement> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${baseUrl}${pagePath}`, { waitUntil: 'networkidle', timeout: NAVIGATION_TIMEOUT_MS });
  const finalPath = new URL(page.url()).pathname;
  const requestedPath = new URL(pagePath, baseUrl).pathname;
  if (finalPath === '/login' && requestedPath !== '/login') {
    throw new CannotCaptureError(
      `${pagePath} が /login へ戻されました。ログイン状態（storageState）を用意してください（docs/runbooks/takt-overnight-preflight.md）`
    );
  }
  // /unauthorized・/unavailable などへ飛ばされた別の画面を測って合格にしない
  if (finalPath !== requestedPath) {
    throw new CannotCaptureError(`${pagePath} が ${finalPath} へ移動しました。ログイン状態のユーザーのロールを確認してください`);
  }
  const screenshot = path.join(out, `${slugOf(pagePath)}-${role}-${viewport.name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const result = await page.evaluate(measure, OVERFLOW_TOLERANCE_PX);
  return {
    role,
    path: pagePath,
    viewport: viewport.name,
    finalPath,
    screenshot: path.resolve(screenshot),
    pageScrollWidth: result.pageScrollWidth,
    pageClientWidth: result.pageClientWidth,
    pageOverflow: result.pageScrollWidth > result.pageClientWidth + OVERFLOW_TOLERANCE_PX,
    cellOverflows: result.cellOverflows,
  };
}

function hasOverflow(measurement: PageMeasurement): boolean {
  return measurement.pageOverflow || measurement.cellOverflows.length > 0;
}

function toMarkdown(measurements: PageMeasurement[], storageStateUsed: boolean): string {
  const lines = [
    '# UI 証跡',
    '',
    `- 画面幅: ${VIEWPORTS.map((viewport) => `${viewport.name}（${viewport.width}x${viewport.height}）`).join(' / ')}`,
    `- ログイン状態: ${storageStateUsed ? 'storageState を使用' : 'なし（認証不要の画面だけ測定可能）'}`,
    '',
    '| 区分 | 画面 | 画面幅 | ページ横はみ出し | セルのはみ出し | スクリーンショット |',
    '|------|------|--------|------------------|----------------|--------------------|',
  ];
  for (const measurement of measurements) {
    const pageOverflow = measurement.pageOverflow
      ? `あり（${measurement.pageScrollWidth} > ${measurement.pageClientWidth}）`
      : 'なし';
    lines.push(
      `| ${measurement.role === 'target' ? '対象' : '既存の類似画面'} | ${measurement.path} | ${measurement.viewport} | ${pageOverflow} | ${measurement.cellOverflows.length} 件 | ${measurement.screenshot} |`
    );
  }
  const overflowing = measurements.filter((measurement) => measurement.cellOverflows.length > 0);
  if (overflowing.length > 0) {
    lines.push('', '## セルのはみ出し（scrollWidth > clientWidth）', '');
    lines.push('| 区分 | 画面 | 画面幅 | 表 | 行 | 列 | 見出し | 中身（先頭40字） | scrollWidth | clientWidth |');
    lines.push('|------|------|--------|----|----|----|--------|------------------|-------------|-------------|');
    for (const measurement of overflowing) {
      for (const cell of measurement.cellOverflows) {
        lines.push(
          `| ${measurement.role === 'target' ? '対象' : '既存の類似画面'} | ${measurement.path} | ${measurement.viewport} | ${cell.table} | ${cell.row} | ${cell.column} | ${cell.header} | ${cell.text.replace(/\|/g, '\\|')} | ${cell.scrollWidth} | ${cell.clientWidth} |`
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<number> {
  const { out, pairs, baseUrl: givenBaseUrl } = parseArgs(process.argv.slice(2));
  mkdirSync(out, { recursive: true });
  const storageStatePath = process.env['TAKT_UI_STORAGE_STATE'] ?? DEFAULT_STORAGE_STATE;
  const storageStateUsed = existsSync(storageStatePath);

  let server: { baseUrl: string; child: ChildProcess } | undefined;
  let browser: Browser | undefined;
  try {
    if (givenBaseUrl === undefined) {
      const envFile = process.env['TAKT_UI_ENV_FILE'];
      if (envFile !== undefined) {
        if (!existsSync(envFile)) {
          throw new CannotCaptureError(`TAKT_UI_ENV_FILE のファイルがありません: ${envFile}`);
        }
        process.loadEnvFile(envFile);
      }
      server = await startDevServer(Number(process.env['TAKT_UI_EVIDENCE_PORT'] ?? DEFAULT_PORT));
    }
    const baseUrl = givenBaseUrl ?? server!.baseUrl;
    browser = await chromium.launch();
    const context = await browser.newContext(storageStateUsed ? { storageState: storageStatePath } : {});
    const page = await context.newPage();
    const measurements: PageMeasurement[] = [];
    for (const viewport of VIEWPORTS) {
      for (const pair of pairs) {
        measurements.push(await measurePage(page, baseUrl, pair.target, 'target', viewport, out));
        if (pair.compare !== undefined) {
          measurements.push(await measurePage(page, baseUrl, pair.compare, 'compare', viewport, out));
        }
      }
    }
    const markdown = toMarkdown(measurements, storageStateUsed);
    writeFileSync(path.join(out, 'ui-evidence.json'), `${JSON.stringify({ viewports: VIEWPORTS, measurements }, null, 2)}\n`);
    writeFileSync(path.join(out, 'ui-evidence.md'), markdown);
    process.stdout.write(markdown);
    return measurements.some((measurement) => measurement.role === 'target' && hasOverflow(measurement))
      ? EXIT_OVERFLOW
      : 0;
  } finally {
    await browser?.close();
    if (server) stopDevServer(server.child);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`採取できません: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = EXIT_CANNOT_CAPTURE;
  });
