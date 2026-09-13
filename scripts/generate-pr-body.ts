/**
 * auto-pr.yml から呼ぶ PR 本文の生成スクリプト。
 *
 * 構成（見出し）は固定テンプレート、中身だけ LLM に書かせる。
 * 使うのは `api-changelog-monitor.yml` と同じ `ZAI_API_KEY`（新しい鍵は増やさない）。
 *
 * **失敗したら黙って exit 1 する。** 呼び出し側（auto-pr.yml）は従来の静的テンプレートへ
 * フォールバックする。PR 作成そのものを LLM の可用性に依存させない。
 *
 * 標準出力に出すのは PR 本文だけ。ログは標準エラーへ出す。
 */

const ZAI_API_KEY = process.env['ZAI_API_KEY'];
const ZAI_CHAT_COMPLETIONS_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const ZAI_MODEL = 'glm-5.2';

/** LLM へ渡す diff の上限。超過分は切り捨てて、切り捨てた事実をプロンプトに明示する */
const MAX_DIFF_CHARS = 60_000;
/** 生成本文の上限。GitHub の本文上限（65536）に対して十分な余裕を取る */
const MAX_BODY_CHARS = 12_000;
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * 本文の先頭に必ず付ける断り書き。
 * **LLM に書かせず、ここで機械的に付ける。** 生成物である事実の明示は、
 * モデルの出力揺れに委ねてよい情報ではない。
 */
const BANNER = [
  '> [!NOTE]',
  '> この本文は `.github/workflows/auto-pr.yml` が diff から自動生成したものです。**作者による確認は行われていません。**',
  '> 検証結果・意図・背景は含まれません（diff から読み取れないため）。必要な場合は作者が追記してください。',
].join('\n');

interface ZaiResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が設定されていません`);
  }
  return value;
}

function buildPrompt(params: {
  branchName: string;
  baseBranch: string;
  commitMessages: string;
  changedFiles: string;
  diff: string;
  diffTruncated: boolean;
}): string {
  const { branchName, baseBranch, commitMessages, changedFiles, diff, diffTruncated } = params;

  return `あなたは GrowMate（Next.js + Supabase の SaaS）のリポジトリで、Pull Request の説明文を書く担当です。
以下の diff とコミットメッセージだけを根拠に、レビュアーが読んで差分を追える本文を Markdown で書いてください。

# 厳守する制約

1. **diff から読み取れることだけを書く。** 意図・背景・目的を推測で書かない。コミットメッセージに書かれている範囲は根拠として使ってよい。
2. **検証結果を書かない。** 「テストが通る」「動作確認済み」「問題ない」等は、diff からは分からないので一切書かない。追加・変更されたテストの「内容」を説明するのは可。
3. **効果や品質を評価しない。** 「改善されます」「安全になります」等の評価語を使わない。何がどう変わるかを事実として書く。
4. 断定できないことは書かないか、「〜と読み取れる」と明示する。
5. 出力は Markdown 本文のみ。前置き・後書き・コードフェンスで全体を囲うことはしない。
6. 全体で ${MAX_BODY_CHARS} 文字以内。日本語で書く。
7. ファイル名・関数名・テーブル名などの固有名詞は diff の表記をそのまま使う。省略や言い換えをしない。

# 見出し構成（この4つを順に使う。該当なしの節は見出しごと省略してよい）

## 概要
1〜3行。この PR が何を変えるか。

## 変更内容
変更を意味のある単位でまとめる。ファイル単位の羅列にしない。主要なファイルパスは \`backtick\` で示す。

## 注意が必要な変更
次のいずれかが diff にあれば必ず書く。無ければ見出しごと省略する。
- DB マイグレーション（適用が別途必要な旨を含む）
- RLS・認可・入力検証の変更
- 破壊的変更、既存挙動の変更
- 環境変数・シークレットの追加
- 外部 API 呼び出しの追加

## レビュー時に見てほしい点
diff の中で判断が分かれうる箇所、レビュアーが意図を確認すべき箇所を挙げる。無ければ見出しごと省略する。

# 入力

## ブランチ
head: ${branchName} / base: ${baseBranch}

## コミットメッセージ
${commitMessages}

## 変更ファイル
${changedFiles}

## diff${diffTruncated ? `（${MAX_DIFF_CHARS} 文字で切り捨て済み。全体は見えていない）` : ''}
${diff}`;
}

async function callZai(prompt: string): Promise<string> {
  const response = await fetch(ZAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('ZAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ZAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Z.AI API error ${response.status}: ${text.substring(0, 300)}`);
  }

  const json = (await response.json()) as ZaiResponse;
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Z.AI API 応答が空です');
  }
  return content;
}

/**
 * 生成結果を本文として使える形に整える。
 * モデルが全体をコードフェンスで囲って返すことがあるため剥がす。
 */
export function normalizeGeneratedBody(raw: string): string {
  let body = raw.trim();

  const fenced = body.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/);
  if (fenced?.[1]) {
    body = fenced[1].trim();
  }

  if (body.length > MAX_BODY_CHARS) {
    body = `${body.substring(0, MAX_BODY_CHARS)}\n\n_（本文が長すぎるため切り捨てました）_`;
  }

  return body;
}

/** 本文の体裁を満たしているか。満たさなければフォールバックさせる */
export function isUsableBody(body: string): boolean {
  return body.length >= 50 && body.includes('## 概要');
}

export function composeBody(generated: string, compareUrl: string): string {
  return `${BANNER}\n\n${generated}\n\n## 比較\n${compareUrl}\n`;
}

async function main(): Promise<void> {
  if (!ZAI_API_KEY) {
    // 鍵が無いのは異常ではない（fork からの push 等）。呼び出し側がフォールバックする
    console.error('[generate-pr-body] ZAI_API_KEY が無いためスキップします');
    process.exit(1);
  }

  const branchName = requireEnv('BRANCH_NAME');
  const baseBranch = requireEnv('BASE_BRANCH');
  const compareUrl = requireEnv('COMPARE_URL');
  const commitMessages = process.env['COMMIT_MESSAGES'] || '- (コミットメッセージなし)';
  const changedFiles = process.env['CHANGED_FILES'] || '- (変更ファイルを取得できませんでした)';
  const rawDiff = process.env['PR_DIFF'] || '';

  if (!rawDiff.trim()) {
    console.error('[generate-pr-body] diff が空のためスキップします');
    process.exit(1);
  }

  const diffTruncated = rawDiff.length > MAX_DIFF_CHARS;
  const diff = diffTruncated ? rawDiff.substring(0, MAX_DIFF_CHARS) : rawDiff;

  const generated = normalizeGeneratedBody(
    await callZai(
      buildPrompt({ branchName, baseBranch, commitMessages, changedFiles, diff, diffTruncated })
    )
  );

  if (!isUsableBody(generated)) {
    throw new Error(`生成された本文が体裁を満たしません: ${generated.substring(0, 200)}`);
  }

  process.stdout.write(composeBody(generated, compareUrl));
}

// テストから import したときは実行しない
if (process.argv[1]?.endsWith('generate-pr-body.ts')) {
  main().catch((error: unknown) => {
    console.error('[generate-pr-body]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
