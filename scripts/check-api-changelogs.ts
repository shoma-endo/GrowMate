import * as crypto from 'crypto';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import type { RequestOptions, IncomingMessage } from 'http';

/**
 * API Changelog Monitor
 *
 * 外部APIのリリースノート・changelogを月次チェックし、
 * 変更が検出された場合に Lark へ通知する（任意で GLM-4.7 要約）。
 *
 * 監視対象:
 *   - GitHub Releases API: OpenAI Node / Supabase JS
 *   - ページ fetch + ハッシュ: Google SC / GA4 / Google Ads
 *   - GLM-4.7 web_search（ZAI_API_KEY あり）: Claude API / WordPress REST API
 */

// ── 型定義 ───────────────────────────────────────────────────────────────────

type TargetType = 'github' | 'webpage' | 'fetch';

interface Target {
  id: string;
  name: string;
  type: TargetType;
  repo?: string;
  url?: string;
  risk: string;
}

interface GitHubRelease {
  tag: string;
  name: string;
  published: string;
  body: string;
  url: string;
}

interface WebpageAiCheckResult {
  hasChanges: boolean;
  summary: string;
}

interface TargetState {
  lastTag?: string;
  hash?: string;
  checkedAt: string;
}

type StateMap = Record<string, TargetState>;

interface DetectedChange {
  name: string;
  risk: string;
  url: string;
  summary: string;
}

interface TargetError {
  name: string;
  message: string;
}

interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

// ── 設定 ─────────────────────────────────────────────────────────────────────

const STATE_FILE = path.join(__dirname, 'api-changelog-state.json');

const LARK_WEBHOOK_URL = process.env['LARK_WEBHOOK_URL'];
const ZAI_API_KEY = process.env['ZAI_API_KEY'];
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'];
const ACTIONS_RUN_URL = process.env['ACTIONS_RUN_URL'];

const ZAI_CHAT_COMPLETIONS_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
const ZAI_MODEL = 'glm-4.7';

const TARGETS: Target[] = [
  {
    id: 'anthropic-platform',
    name: 'Claude API リリースノート',
    type: 'webpage',
    url: 'https://platform.claude.com/docs/ja/release-notes/overview',
    risk: '高',
  },
  {
    id: 'openai-node',
    name: 'OpenAI Node SDK',
    type: 'github',
    repo: 'openai/openai-node',
    risk: '高',
  },
  {
    id: 'supabase-js',
    name: 'Supabase JS',
    type: 'github',
    repo: 'supabase/supabase-js',
    risk: '中',
  },
  {
    id: 'google-search-console-api',
    name: 'Google Search Console API',
    type: 'fetch',
    url: 'https://developers.google.com/search/updates',
    risk: '中',
  },
  {
    id: 'google-analytics-data-api',
    name: 'Google Analytics Data API (GA4)',
    type: 'fetch',
    url: 'https://developers.google.com/analytics/devguides/reporting/data/v1/changelog',
    risk: '中',
  },
  {
    id: 'google-ads-api',
    name: 'Google Ads API',
    type: 'fetch',
    url: 'https://developers.google.com/google-ads/api/docs/release-notes',
    risk: '中',
  },
  {
    id: 'wordpress-rest-api',
    name: 'WordPress REST API',
    type: 'webpage',
    url: 'https://developer.wordpress.org/rest-api/changelog/',
    risk: '低',
  },
];

// ── HTTP ヘルパー ─────────────────────────────────────────────────────────────

function httpRequest(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions: RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: options.method ?? 'GET',
      headers: {
        'User-Agent': 'GrowMate-APIMonitor/1.0 (github-actions)',
        ...options.headers,
      },
      timeout: 30000,
    };

    const req = https.request(reqOptions, (res: IncomingMessage) => {
      // 301/302 リダイレクト対応（最大1回）
      const location = res.headers['location'];
      if (
        res.statusCode !== undefined &&
        res.statusCode >= 301 &&
        res.statusCode <= 302 &&
        location
      ) {
        const redirectUrl = typeof location === 'string' ? location : location[0];
        if (redirectUrl) {
          httpRequest(redirectUrl, options).then(resolve).catch(reject);
          return;
        }
      }

      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: data,
          headers: res.headers as Record<string, string | string[] | undefined>,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── データ取得 ─────────────────────────────────────────────────────────────────

async function fetchGitHubReleases(repo: string): Promise<GitHubRelease[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }

  const { status, body } = await httpRequest(
    `https://api.github.com/repos/${repo}/releases?per_page=20`,
    { headers }
  );

  if (status !== 200) {
    throw new Error(`GitHub API error ${status}: ${body.substring(0, 300)}`);
  }

  interface RawRelease {
    tag_name: string;
    name: string;
    published_at: string;
    body: string;
    html_url: string;
  }

  const releases = JSON.parse(body) as RawRelease[];
  return releases.map((r) => ({
    tag: r.tag_name,
    name: r.name,
    published: (r.published_at ?? '').substring(0, 10),
    body: (r.body ?? '（リリースノートなし）').substring(0, 2000),
    url: r.html_url,
  }));
}

// ── ページ fetch + ハッシュ監視（Google 公式 changelog）────────────────────

async function fetchPageContent(url: string): Promise<string> {
  const { status, body } = await httpRequest(url);
  if (status !== 200) {
    throw new Error(`Fetch error ${status}: ${body.substring(0, 300)}`);
  }
  return body;
}

function hashPageContent(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

interface FetchCheckResult {
  changed: boolean;
  hash: string;
  isBaseline: boolean;
}

async function checkWebpageByFetch(url: string, prevHash?: string): Promise<FetchCheckResult> {
  const content = await fetchPageContent(url);
  const hash = hashPageContent(content);
  if (!prevHash) {
    return { changed: false, hash, isBaseline: true };
  }
  return { changed: hash !== prevHash, hash, isBaseline: false };
}

function isZaiBalanceError(message: string): boolean {
  return message.includes('Insufficient balance') || message.includes('"code":"1113"');
}

function buildDetectedChangesSummary(changedItems: DetectedChange[]): string {
  return changedItems
    .map((c) => `### ${c.name}（影響度目安: ${c.risk}）\n${c.summary}`)
    .join('\n\n---\n\n');
}

type ZaiWebSearchTool = {
  type: 'web_search';
  web_search: {
    enable: boolean;
    search_engine: string;
    count: number;
    search_recency_filter: string;
    search_domain_filter?: string;
  };
};

interface ZaiChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  thinking?: { type: string };
  response_format?: { type: string };
  tools?: ZaiWebSearchTool[];
}

interface ZaiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function hostnameFromUrl(pageUrl: string): string | undefined {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return undefined;
  }
}

function buildWebSearchTool(pageUrl: string): ZaiWebSearchTool[] {
  const hostname = hostnameFromUrl(pageUrl);
  const webSearch: ZaiWebSearchTool['web_search'] = {
    enable: true,
    search_engine: 'search_pro_jina',
    count: 10,
    search_recency_filter: 'oneMonth',
  };
  if (hostname) {
    webSearch.search_domain_filter = hostname;
  }
  return [{ type: 'web_search', web_search: webSearch }];
}

interface AiCheckResult {
  hasChanges?: boolean;
  summary?: string;
}

function parseAiCheckJson(text: string): AiCheckResult {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as AiCheckResult;
  } catch {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`AI応答のJSONパースに失敗しました: ${trimmed.substring(0, 200)}`);
    }
    return JSON.parse(jsonMatch[0]) as AiCheckResult;
  }
}

async function callZaiChatCompletion(request: ZaiChatCompletionRequest): Promise<string> {
  if (!ZAI_API_KEY) {
    throw new Error('ZAI_API_KEY が設定されていません');
  }

  const requestBody = JSON.stringify(request);
  const { status, body } = await httpRequest(ZAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ZAI_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(requestBody)),
    },
    body: requestBody,
  });

  if (status !== 200) {
    throw new Error(`Z.AI API error ${status}: ${body.substring(0, 300)}`);
  }

  const res = JSON.parse(body) as ZaiChatCompletionResponse;
  const content = res.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Z.AI API 応答が空です');
  }
  return content;
}

async function checkWebpageWithAI(
  target: Target & { url: string },
  lastCheckedAt: string,
): Promise<WebpageAiCheckResult> {
  if (!ZAI_API_KEY) {
    throw new Error('ZAI_API_KEY が設定されていません');
  }

  const lastDate = new Date(lastCheckedAt).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const prompt = `${target.name} のchangelog・リリースノートページ（${target.url}）を検索し、${lastDate}より後に追加された新しいエントリを確認してください。

以下のJSON形式のみで回答してください（前後に説明文は不要）：
{
  "hasChanges": true または false,
  "summary": "変更内容の要約（hasChanges が true の場合のみ記載）"
}

hasChanges を true にする条件（実際のAPI仕様変更のみ）：
- 新バージョンのリリース
- APIエンドポイントの追加・変更・削除
- パラメータや返却値の仕様変更
- 非推奨（deprecated）の通知
- 破壊的変更（breaking changes）

hasChanges を false にする条件（無視する変化）：
- ページデザイン・ナビゲーション変更
- 軽微なドキュメント誤字修正
- ${lastDate}以前の変更`;

  const content = await callZaiChatCompletion({
    model: ZAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    thinking: { type: 'disabled' },
    max_tokens: 800,
    response_format: { type: 'json_object' },
    tools: buildWebSearchTool(target.url),
  });

  const result = parseAiCheckJson(content);
  return {
    hasChanges: result.hasChanges ?? false,
    summary: result.summary ?? '',
  };
}

// ── AI 要約 ───────────────────────────────────────────────────────────────────

async function summarizeWithGlm(changedItems: DetectedChange[]): Promise<string> {
  const contextBlock = changedItems
    .map((c) => `### ${c.name}（影響度目安: ${c.risk}）\n${c.summary}`)
    .join('\n\n---\n\n');

  const prompt = `あなたはGrowMateプロジェクトの技術担当者です。
GrowMateは Next.js + TypeScript + Supabase を使ったマーケティングSaaSです。

## このプロジェクトにおける各APIの具体的な利用方法

### Anthropic Claude API
- SDK: @anthropic-ai/sdk（anthropic.messages.stream / anthropic.messages.create）
- 使用モデル: claude-sonnet-4-6
- 用途: チャット応答生成・ブログ記事生成・SEO改善提案生成（streaming）
- 依存パラメータ: model / max_tokens / temperature / system / messages / stream
- 注意点: extended-thinking（budgetTokens）を一部で使用

### OpenAI API
- SDK: openai（client.chat.completions.create / stream）
- 使用モデル: gpt-4o, gpt-4o-mini など
- 用途: チャット応答生成（Anthropicの代替として選択可能）
- 依存パラメータ: model / max_tokens / temperature / messages / stream

### Supabase JS SDK
- SDK: @supabase/supabase-js, @supabase/ssr
- 用途: 認証(auth.getUser/signInWithOtp)・DB操作(select/insert/update/upsert/delete)・RLS
- 依存機能: createClient / createServerClient / Row Level Security / Storage / Realtime

### Google Search Console API
- クライアント: googleapis（google.webmasters v3）
- 使用エンドポイント: searchanalytics.query（クリック数・表示回数・CTR・順位取得）
- 認証: OAuth2（access_token / refresh_token）
- 依存パラメータ: siteUrl / startDate / endDate / dimensions / rowLimit

### Google Analytics Data API (GA4)
- クライアント: googleapis（google.analyticsdata v1beta）
- 使用メソッド: properties.runReport（PV・セッション数・ユーザー数取得）
- 認証: OAuth2
- 依存パラメータ: property / dateRanges / dimensions / metrics

### Google Ads API
- クライアント: google-ads-api（Customer.query / GAQL）
- 使用リソース: campaign / ad_group / metrics（インプレッション・クリック・コスト）
- 認証: OAuth2 + developer_token
- 依存パラメータ: customer_id / GAQLクエリ構文

### WordPress REST API
- 認証: Application Password（Basic認証）または WordPress.com OAuth2
- 使用エンドポイント: GET /wp-json/wp/v2/posts（記事一覧取得）
- 依存パラメータ: per_page / page / _fields / status

---

## 変更検出内容

${contextBlock}

---

## 分析指示

上記の「具体的な利用方法」を踏まえ、**このプロジェクトの実装に実際に影響が出るかどうか**を判断してください。
ページのデザイン変更やドキュメントの追記など、実装に影響しない変化は「対応不要」と判断してください。

変更ごとに以下の形式で回答してください：

🔴 破壊的変更（我々の実装に直接影響）: 具体的に / なければ「なし」
🟡 重要な仕様変更・新機能（対応を検討すべき）: 具体的に / なければ「なし」
🟢 非推奨化（将来対応が必要）: 具体的に / なければ「なし」
⚡ 対応優先度: 即座に対応 / 今週中 / 次回リリース時 / 対応不要

全件が実装に影響しない場合は「全件軽微、対応不要」の1行のみ記載してください。`;

  return callZaiChatCompletion({
    model: ZAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    thinking: { type: 'disabled' },
    max_tokens: 1000,
  });
}

// ── Lark 通知 ─────────────────────────────────────────────────────────────────

async function sendLarkNotification(text: string): Promise<void> {
  if (!LARK_WEBHOOK_URL) {
    throw new Error('LARK_WEBHOOK_URL が設定されていません');
  }
  const payload = JSON.stringify({ msg_type: 'text', content: { text } });
  const { status, body } = await httpRequest(LARK_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
    },
    body: payload,
  });
  if (status < 200 || status >= 300) {
    throw new Error(`Lark webhook HTTP ${status}: ${body.substring(0, 200)}`);
  }
  console.log(`Lark 送信結果: ${status}`);
}

// ── 状態管理 ──────────────────────────────────────────────────────────────────

function loadState(): StateMap {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as StateMap;
  } catch {
    return {};
  }
}

function saveState(state: StateMap): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const state = loadState();
  const detected: DetectedChange[] = [];
  const errors: TargetError[] = [];

  for (const target of TARGETS) {
    console.log(`\n📡 ${target.name} をチェック中...`);
    const prev = state[target.id] ?? ({} as TargetState);

    try {
      if (target.type === 'github' && target.repo) {
        const releases = await fetchGitHubReleases(target.repo);
        const latestTag = releases[0]?.tag ?? '(不明)';
        const prevTag = prev.lastTag;

        if (!prevTag) {
          state[target.id] = { lastTag: latestTag, checkedAt: new Date().toISOString() };
          console.log(`  ✅ 初回ベースライン記録: ${latestTag}`);
          continue;
        }

        if (latestTag !== prevTag) {
          const newReleases: GitHubRelease[] = [];
          for (const r of releases) {
            if (r.tag === prevTag) break;
            newReleases.push(r);
          }

          detected.push({
            name: target.name,
            risk: target.risk,
            url: newReleases[0]?.url ?? `https://github.com/${target.repo}/releases`,
            summary: [
              `バージョン: ${prevTag} → ${latestTag}`,
              ...newReleases.map((r) => `\n**${r.tag}** (${r.published})\n${r.body}\n${r.url}`),
            ].join('\n'),
          });

          state[target.id] = { lastTag: latestTag, checkedAt: new Date().toISOString() };
          console.log(`  🔔 新リリース検出: ${prevTag} → ${latestTag}`);
        } else {
          state[target.id] = { ...prev, checkedAt: new Date().toISOString() };
          console.log(`  ✅ 変更なし (${latestTag})`);
        }
      } else if (target.type === 'fetch' && target.url) {
        const { changed, hash, isBaseline } = await checkWebpageByFetch(target.url, prev.hash);

        if (isBaseline) {
          state[target.id] = { hash, checkedAt: new Date().toISOString() };
          console.log('  ✅ 初回ベースライン記録（ページハッシュ）');
          continue;
        }

        if (changed) {
          detected.push({
            name: target.name,
            risk: target.risk,
            url: target.url,
            summary:
              '公式 changelog ページの内容が前回チェック時から変更されました。詳細は URL を確認してください。',
          });
          state[target.id] = { hash, checkedAt: new Date().toISOString() };
          console.log('  🔔 ページ変更検出（ハッシュ不一致）');
        } else {
          state[target.id] = { hash, checkedAt: new Date().toISOString() };
          console.log('  ✅ 変更なし（ハッシュ一致）');
        }
      } else if (target.type === 'webpage' && target.url) {
        if (!ZAI_API_KEY) {
          console.log('  ⏭️ ZAI_API_KEY 未設定のためスキップ');
          continue;
        }

        const lastCheckedAt = prev.checkedAt;

        if (!lastCheckedAt) {
          state[target.id] = { checkedAt: new Date().toISOString() };
          console.log('  ✅ 初回ベースライン記録');
          continue;
        }

        const { hasChanges, summary } = await checkWebpageWithAI(
          target as Target & { url: string },
          lastCheckedAt,
        );

        if (hasChanges) {
          detected.push({
            name: target.name,
            risk: target.risk,
            url: target.url,
            summary: summary || `変更を検出しました (${target.url})`,
          });
          state[target.id] = { checkedAt: new Date().toISOString() };
          console.log('  🔔 変更検出');
        } else {
          state[target.id] = { ...prev, checkedAt: new Date().toISOString() };
          console.log('  ✅ 変更なし');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (target.type === 'webpage' && isZaiBalanceError(message)) {
        console.log('  ⏭️ Z.AI 残高不足のためスキップ');
        continue;
      }
      console.error(`  ❌ エラー: ${message}`);
      errors.push({ name: target.name, message });
    }
  }

  if (detected.length === 0 && errors.length === 0) {
    saveState(state);
    console.log('\n✅ 全件変更なし。Lark 通知はスキップします。');
    return;
  }

  let aiSummary = '';
  if (detected.length > 0) {
    if (ZAI_API_KEY) {
      console.log('\n🤖 GLM-4.7 で変更内容を解析中...');
      try {
        aiSummary = await summarizeWithGlm(detected);
        console.log('  ✅ 解析完了');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isZaiBalanceError(message)) {
          console.log('  ⏭️ Z.AI 残高不足のため要約をスキップ（検出内容のみ通知）');
          aiSummary = buildDetectedChangesSummary(detected);
        } else {
          console.error(`  ❌ Z.AI API エラー: ${message}`);
          aiSummary = buildDetectedChangesSummary(detected);
        }
      }
    } else {
      aiSummary = buildDetectedChangesSummary(detected);
    }
  }

  const dateJst = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const lines: string[] = [`【API Changelog 定期チェック】`, `実施日: ${dateJst}`];

  if (detected.length > 0) {
    lines.push(`変更検出: ${detected.length}件`);
    lines.push('');
    lines.push('── 変更箇所 ──');
    for (const d of detected) {
      lines.push(`🔔 [リスク:${d.risk}] ${d.name}`);
      lines.push(`   ${d.url}`);
    }
  }
  if (errors.length > 0) {
    lines.push(`チェックエラー: ${errors.length}件 (${errors.map((e) => e.name).join('、')})`);
  }
  if (aiSummary) {
    lines.push('', '── AI解析結果 ──', aiSummary);
  }
  if (errors.length > 0) {
    lines.push('', '── エラー詳細 ──');
    for (const e of errors) {
      lines.push(`❌ ${e.name}: ${e.message}`);
    }
  }
  if (ACTIONS_RUN_URL) {
    lines.push('', `ログ: ${ACTIONS_RUN_URL}`);
  }

  console.log('\n📨 Lark に通知送信中...');
  await sendLarkNotification(lines.join('\n'));
  saveState(state);
  console.log('✅ 完了');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
