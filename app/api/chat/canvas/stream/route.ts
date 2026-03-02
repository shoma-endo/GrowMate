import { NextRequest } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { chatService } from '@/server/services/chatService';
import { headingFlowService } from '@/server/services/headingFlowService';
import { SupabaseService } from '@/server/services/supabaseService';
import { env } from '@/env';
import { MODEL_CONFIGS } from '@/lib/constants';
import { htmlToMarkdownForCanvas, sanitizeHtmlForCanvas } from '@/lib/canvas-content';
import { checkTrialDailyLimit } from '@/server/services/chatLimitService';
import type { UserRole } from '@/types/user';
import { VIEW_MODE_ERROR_MESSAGE } from '@/server/lib/view-mode';
import { HEADING_FLOW_STEP_ID } from '@/lib/constants';

export const runtime = 'nodejs';
export const maxDuration = 800;

interface WebReference {
  url: string;
  context?: string;
}

interface CanvasStreamRequest {
  sessionId: string;
  instruction: string;
  selectedText: string;
  canvasContent: string;
  targetStep: string;
  enableWebSearch?: boolean;
  freeFormUserPrompt?: string;
  /** Step7見出し単位生成中の場合 true。1見出し分のみ編集するようプロンプトを制約する */
  isHeadingUnit?: boolean;
  /** Step7見出し単位生成時の見出しインデックス。BlogPreviewTile の見出し表示に利用 */
  step7HeadingIndex?: number;
  webSearchConfig?: {
    maxUses?: number;
    allowedDomains?: string[];
    blockedDomains?: string[];
  };
}

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});
const supabaseService = new SupabaseService();

const URL_REGEX = /(https?:\/\/[^\s)'"<>]+)(?![^[]*])/gi;
const DISALLOWED_HOST_NAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
const DISALLOWED_HOST_KEYWORDS = ['internal', 'intranet', 'corp', 'local'];
const DISALLOWED_TLDS = new Set(['local', 'internal', 'test', 'invalid', 'example']);

// Tool Use スキーマ定義
const CANVAS_EDIT_TOOL = {
  name: 'apply_full_text_replacement',
  description:
    '文章全体を置き換えます。必ずこのツールを使用して、編集後の完全なMarkdown文章を返してください。',
  input_schema: {
    type: 'object' as const,
    properties: {
      full_markdown: {
        type: 'string',
        description: '編集後の完全なMarkdown文章（省略なし、最初から最後まで全文）',
      },
    },
    required: ['full_markdown'],
  },
};

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let eventId = 0;

  const extractWebReferences = (text: string): WebReference[] => {
    const references = new Map<string, WebReference>();
    if (!text) return [];

    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const matches = line.match(URL_REGEX);
      if (!matches) continue;

      for (const rawUrl of matches) {
        let parsed: URL | null = null;
        try {
          parsed = new URL(rawUrl);
        } catch {
          continue;
        }

        const hostname = parsed.hostname.toLowerCase();
        if (!hostname.includes('.')) continue;
        if (DISALLOWED_HOST_NAMES.has(hostname)) continue;
        if (DISALLOWED_HOST_KEYWORDS.some(keyword => hostname.includes(keyword))) continue;

        const tld = hostname.split('.').pop() ?? '';
        if (!/^[a-z]{2,24}$/.test(tld)) continue;
        if (DISALLOWED_TLDS.has(tld)) continue;

        if (!references.has(parsed.href)) {
          references.set(parsed.href, { url: parsed.href, context: line });
        }
      }
    }

    return Array.from(references.values());
  };

  const sendSSE = (event: string, data: unknown) => {
    return encoder.encode(`id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const sendPing = () => {
    return encoder.encode(`id: ${++eventId}\nevent: ping\ndata: {}\n\n`);
  };

  try {
    const {
      sessionId,
      instruction,
      selectedText,
      canvasContent,
      targetStep,
      enableWebSearch = false,
      freeFormUserPrompt,
      isHeadingUnit = false,
      step7HeadingIndex,
      webSearchConfig = {},
    }: CanvasStreamRequest = await req.json();
    const normalizedFreeFormPrompt =
      typeof freeFormUserPrompt === 'string' ? freeFormUserPrompt.trim() : undefined;
    const enableWebSearchRequested = enableWebSearch ?? false;
    const shouldEnableWebSearch =
      normalizedFreeFormPrompt !== undefined
        ? normalizedFreeFormPrompt.includes('検索')
        : enableWebSearchRequested;

    // 認証チェック
    const authHeader = req.headers.get('authorization');
    const liffAccessToken = authHeader?.replace('Bearer ', '');

    const authResult = await authMiddleware(liffAccessToken);
    if (authResult.error || authResult.requiresSubscription) {
      return new Response(
        sendSSE('error', {
          type: 'auth',
          message: authResult.error || 'サブスクリプションが必要です',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
          },
        }
      );
    }
    if (authResult.viewMode) {
      return new Response(
        sendSSE('error', {
          type: 'view_mode',
          message: VIEW_MODE_ERROR_MESSAGE,
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
          },
        }
      );
    }

    const { userId, userDetails } = authResult;
    const userRole = (userDetails?.role ?? 'trial') as UserRole;

    const limitError = await checkTrialDailyLimit(userRole, userId);
    if (limitError) {
      return new Response(sendSSE('error', { type: 'daily_limit', message: limitError }), {
        status: 429,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        },
      });
    }

    // MODEL_CONFIGSから設定を取得
    const modelKey = `blog_creation_${targetStep}`;
    const modelConfig = MODEL_CONFIGS[modelKey];

    if (!modelConfig) {
      return new Response(
        sendSSE('error', { type: 'config', message: `モデル設定が見つかりません: ${modelKey}` }),
        { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
      );
    }

    if (modelConfig.provider !== 'anthropic') {
      return new Response(
        sendSSE('error', {
          type: 'config',
          message: `Canvas編集はAnthropicモデルのみサポートしています: ${modelKey}`,
        }),
        { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
      );
    }

    const { maxTokens, temperature, actualModel } = modelConfig;

    const isHeadingUnitRequest = targetStep === HEADING_FLOW_STEP_ID && isHeadingUnit;

    // Step7 見出し単位モード時の前置制約（全文生成を防ぎ、1見出し分のみ編集させる）
    const headingUnitPrefix =
      isHeadingUnitRequest
        ? [
            '## 【重要】見出し単位編集モード',
            '',
            '表示されているのは**1見出し分の本文のみ**です。他セクション・タイトル・リード文は存在しません。',
            '',
            '**出力制約（厳守）**:',
            '- full_markdown には、この1見出し分の本文のみを返してください。',
            '- 見出し行（`###` や `####`）は自動付与されるため出力に含めないでください（二重化防止）。',
            '- 他の見出し・セクション・タイトル・リード文を生成・追加しないでください。',
            '',
            '---',
            '',
          ]
        : [];
    const outputRules = isHeadingUnitRequest
      ? [
          '1. **必ず apply_full_text_replacement ツールを使用する**',
          '2. **full_markdown には、この1見出し分の本文のみを含める**',
          '3. **見出し行（###/####）は含めない**',
          '4. **他セクション・タイトル・リード文を追加しない**',
        ]
      : [
          '1. **必ず apply_full_text_replacement ツールを使用する**',
          '2. **full_markdown パラメータには、編集後の文章全体を最初から最後まで完全に含める**',
          '3. **絶対に省略しない：** 「...（省略）...」「※以下同様」「（中略）」などの表現は厳禁',
          '4. **選択範囲以外の部分も必ず全て含める：** タイトル、見出し、本文、すべてのセクションを出力',
          '5. **文章の一部だけを返すことは厳禁：** 必ず冒頭から末尾まで完全で高品質な文章を返す',
        ];
    const roleInstruction = isHeadingUnitRequest
      ? 'あなたは文章編集の専門エディターです。ユーザーが選択した部分の改善指示を受けて、**表示中の1見出し分本文だけを編集して出力**します。'
      : 'あなたは文章編集の専門エディターです。ユーザーが選択した部分の改善指示を受けて、**高品質で一貫性のある文章全体を編集して完全な全文を出力**します。';
    const finalCheckRules = isHeadingUnitRequest
      ? [
          '- 編集後の本文を読み直す',
          '- 他セクション・タイトル・リード文が混入していないか確認する',
          '- 見出し行（###/####）を含めていないか確認する',
        ]
      : [
          '- 編集後の文章全体を読み直す',
          '- 矛盾や違和感がないか確認する',
          '- 冒頭から末尾まで完全に含まれているか確認する',
        ];
    const finalOutputInstruction = isHeadingUnitRequest
      ? '改善を適用した上で、**この1見出し分の本文のみを省略なく出力してください。**'
      : '改善を適用した上で、**文章全体を省略なく完全に出力してください。**';

    // システムプロンプト（Claude 4ベストプラクティス準拠）
    const systemPrompt = [
      ...headingUnitPrefix,
      '# Canvas編集専用モード',
      '',
      '## あなたの役割',
      roleInstruction,
      '',
      '## 【最重要】出力形式の絶対ルール',
      ...outputRules,
      '',
      '## 編集の進め方（各ステップで慎重に検討してください）',
      '**ステップ1：全体把握**',
      '- 下記の「現在の文章全体」を最初から最後まで読む',
      '- 文章の構成、トーン、キーワード、主張の流れを把握する',
      '- 読者の視点を意識し、情報の階層構造を理解する',
      '',
      '**ステップ2：改善指示の理解**',
      '- 「ユーザーが選択した範囲」に対する改善指示を正確に理解する',
      '- 指示の意図（明確化、簡潔化、詳細化、トーン変更など）を把握する',
      '- 改善によって達成すべき目標を明確にする',
      '',
      '**ステップ3：関連箇所の洗い出し**',
      '- 選択範囲と同じテーマ、主張、数値、用語が登場する全ての箇所を特定する',
      '- 段落、見出し、リスト、表、注釈などあらゆる要素を確認する',
      '- 一貫性を保つために同様の修正が必要な箇所をリストアップする',
      '',
      '**ステップ4：編集の実行**',
      '- 選択範囲に改善指示を適用する',
      '- 関連箇所にも同様の修正を適用し、整合性を確保する',
      '- トーン、語尾、用語、数値、リンクの一貫性を全文で整える',
      '- 重複表現を削除し、自然な流れを保つ',
      '',
      '**ステップ5：最終検証**',
      ...finalCheckRules,
      '- 確認が完了したら apply_full_text_replacement を実行する',
      '',
      '## 重要な品質基準',
      '- 同じ課題・数値・根拠・引用表現が他の段落・見出し・表・箇条書きにも存在する場合は、整合性を取るようまとめて修正する',
      '- 重複する表現や語尾、トーンの違和感があれば統一し、文章全体で自然な流れを保つ',
      '- 選択範囲だけでなく、関連する箇所の用語・リンク・ファクトが一貫した内容になるように調整する',
      '- 修正後は前後関係やUXを崩さず、無関係な要素や矛盾を残さない',
      '- 読者にとって価値のある、完成度の高い文章を提供する',
      '- 文章全体にタイトル・メタディスクリプションに関する情報が含まれている場合は、該当部分を完全に削除する',
      '',
      '---',
      '',
      '## 現在の文章全体（編集対象）',
      '```markdown',
      canvasContent,
      '```',
      '',
      '## ユーザーが選択した範囲（この部分を改善）',
      '```',
      selectedText,
      '```',
      '',
      '上記の「選択した範囲」に対する改善指示がユーザーメッセージで送られます。',
      finalOutputInstruction,
      '各ステップを慎重に実行し、高品質で一貫性のある編集結果を提供してください。',
    ]
      .filter(Boolean)
      .join('\n');

    // ReadableStreamを作成
    const stream = new ReadableStream({
      async start(controller) {
        let accumulatedJson = '';
        let finalMarkdown = '';
        let abortController: AbortController | null = new AbortController();
        let idleTimeout: ReturnType<typeof setTimeout> | null = null;
        let pingInterval: ReturnType<typeof setInterval> | null = null;

        // 初回バイト送出（SSEタイムアウト回避）
        controller.enqueue(encoder.encode(`: open\n\n`));

        const resetIdleTimeout = () => {
          if (idleTimeout) clearTimeout(idleTimeout);
          idleTimeout = setTimeout(() => {
            console.warn('[Canvas Stream] Idle timeout reached');
            abortController?.abort();
          }, 300000); // 300秒（5分）のアイドルタイムアウト
        };

        const cleanup = () => {
          if (idleTimeout) clearTimeout(idleTimeout);
          if (pingInterval) clearInterval(pingInterval);
          abortController = null;
        };

        try {
          // ping送信でアイドル切断を防ぐ
          pingInterval = setInterval(() => {
            if (!abortController?.signal.aborted) {
              controller.enqueue(sendPing());
              resetIdleTimeout();
            }
          }, 20000); // 20秒ごとにping

          resetIdleTimeout();

          // ✅ 第1段階: Web検索の実行（shouldEnableWebSearchがtrueの場合のみ）
          let searchResults = '';
          let extractedReferences: WebReference[] = [];
          if (shouldEnableWebSearch) {
            try {
              console.log('[Canvas Web Search] Starting web search phase...');

              const searchStream = await anthropic.messages.stream({
                model: actualModel,
                max_tokens: 2000,
                temperature: 0.3,
                system: [
                  {
                    type: 'text',
                    text: 'あなたはWeb検索の専門家です。ユーザーの指示に基づいて、必要な最新情報をweb_searchツールで検索してください。検索結果を簡潔にまとめて返してください。',
                    cache_control: { type: 'ephemeral' },
                  },
                ],
                tools: [
                  {
                    type: 'web_search_20250305' as const,
                    name: 'web_search' as const,
                    max_uses: webSearchConfig.maxUses || 3,
                    ...(webSearchConfig.allowedDomains && {
                      allowed_domains: webSearchConfig.allowedDomains,
                    }),
                    ...(webSearchConfig.blockedDomains && {
                      blocked_domains: webSearchConfig.blockedDomains,
                    }),
                  },
                ],
                tool_choice: { type: 'tool', name: 'web_search' },
                messages: [
                  {
                    role: 'user',
                    content: `以下の指示に必要な最新情報を検索してください：${instruction}`,
                  },
                ],
              });

              // 検索結果を収集
              for await (const event of searchStream) {
                if (abortController?.signal.aborted) break;
                resetIdleTimeout();

                if (event.type === 'content_block_start') {
                  console.log(
                    '[Canvas Web Search] Search event:',
                    JSON.stringify(event.content_block)
                  );
                }

                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                  searchResults += event.delta.text;
                }
              }

              console.log(
                '[Canvas Web Search] Search completed. Results length:',
                searchResults.length
              );
              extractedReferences = extractWebReferences(searchResults);
            } catch (searchError) {
              console.error('[Canvas Web Search] Search failed:', searchError);
              // 検索失敗時は空の結果で続行
              searchResults = '';
              extractedReferences = [];
            }
          }

          // ✅ 第2段階: Canvas編集（検索結果を含める）
          const finalSystemPrompt = [
            systemPrompt,
            ...(searchResults
              ? [
                  '',
                  '---',
                  '',
                  extractedReferences.length > 0
                    ? [
                        '## Web検索で確認できた外部リンク（以下のみ使用可）',
                        ...extractedReferences.map(
                          (reference, index) =>
                            `${index + 1}. ${reference.url}${
                              reference.context ? ` （関連情報: ${reference.context}）` : ''
                            }`
                        ),
                        '',
                        '外部リンクを挿入する場合は、上記のURLのみを利用してください。新しいドメインや存在しないURLを生成してはいけません。',
                      ].join('\n')
                    : [
                        '## Web検索で利用可能な外部リンクは見つかりませんでした',
                        '外部リンクを提示せず、文章そのものを改善してください。存在しないURLを作成してはいけません。',
                      ].join('\n'),
                  '',
                  '---',
                  '',
                  '## Web検索結果の要約テキスト',
                  '```',
                  searchResults,
                  '```',
                  '',
                  extractedReferences.length > 0
                    ? '上記リンクと要約を活用して文章を編集してください。'
                    : '要約は参考情報に留め、外部リンクは追加しないでください。',
                ]
              : []),
          ].join('\n');

          // Anthropic Streaming API 呼び出し
          // Step7 の見出し単位編集時は上限を抑え、それ以外はモデル設定値を使う。
          const canvasMaxTokens = isHeadingUnitRequest ? Math.min(5000, maxTokens) : maxTokens;
          const apiStream = await anthropic.messages.stream({
            model: actualModel,
            max_tokens: canvasMaxTokens,
            temperature,
            system: [
              {
                type: 'text',
                text: finalSystemPrompt,
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: [CANVAS_EDIT_TOOL],
            tool_choice: { type: 'tool', name: 'apply_full_text_replacement' },
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: instruction }],
              },
            ],
          });

          // ストリーミングデータを処理
          for await (const event of apiStream) {
            if (abortController?.signal.aborted) break;

            resetIdleTimeout();

            // デバッグ用ログ
            if (event.type === 'content_block_start') {
              console.log(
                '[Canvas Edit Debug] content_block_start:',
                JSON.stringify(event.content_block)
              );
            }

            if (event.type === 'content_block_delta') {
              if (event.delta.type === 'input_json_delta') {
                const chunk = event.delta.partial_json;
                controller.enqueue(sendSSE('chunk', { content: chunk }));
                accumulatedJson += chunk;
              }
            }

            if (event.type === 'message_stop') {
              // Tool Useの結果を抽出
              const message = await apiStream.finalMessage();
              const toolUseBlock = message.content.find(
                block => block.type === 'tool_use' && block.name === 'apply_full_text_replacement'
              );

              if (toolUseBlock && toolUseBlock.type === 'tool_use') {
                const toolInput = toolUseBlock.input as {
                  full_markdown?: string;
                  markdown?: string;
                  replacement_html?: string;
                  replacement?: string;
                  full_html?: string;
                  html?: string;
                };

                const markdownCandidate = toolInput.full_markdown ?? toolInput.markdown ?? '';
                finalMarkdown = markdownCandidate.trim();

                if (!finalMarkdown) {
                  const htmlCandidate =
                    toolInput.replacement_html ??
                    toolInput.replacement ??
                    toolInput.full_html ??
                    toolInput.html;
                  if (typeof htmlCandidate === 'string' && htmlCandidate.trim().length > 0) {
                    const sanitized = sanitizeHtmlForCanvas(htmlCandidate);
                    finalMarkdown = htmlToMarkdownForCanvas(sanitized);
                  }
                }
              }

              // フォールバック: Tool Useが見つからない場合
              if (!finalMarkdown.trim()) {
                // 1. 通常のテキスト回答として返ってきた可能性があるためチェック
                const textBlock = message.content.find(block => block.type === 'text');
                if (textBlock && textBlock.type === 'text') {
                  console.warn('[Canvas Stream] Tool use missing, using text content fallback.');
                  finalMarkdown = textBlock.text.trim();
                }

                // 2. それでも空で、かつJSONデータが蓄積されている場合（max_tokens等で途中終了したケース）
                if (!finalMarkdown.trim() && accumulatedJson.trim()) {
                  console.warn(
                    '[Canvas Stream] Attempting to recover markdown from partial JSON...'
                  );
                  // JSON形式: {"full_markdown": "..."} の想定
                  // "full_markdown"キーの値部分を抽出する正規表現（閉じクォート手前までキャプチャ）
                  const match = accumulatedJson.match(
                    /"(?:full_)?markdown"\s*:\s*"((?:[^"\\]|\\.)*)/
                  );
                  if (match && match[1]) {
                    const rawContent = match[1];
                    try {
                      // JSON文字列としてアンエスケープ
                      finalMarkdown = JSON.parse(`"${rawContent}"`);
                    } catch {
                      // パース失敗時は簡易的なアンエスケープを行う
                      console.warn(
                        '[Canvas Stream] JSON unescape failed, using raw content with manual unescape'
                      );
                      finalMarkdown = rawContent
                        .replace(/\\n/g, '\n')
                        .replace(/\\r/g, '\r')
                        .replace(/\\t/g, '\t')
                        .replace(/\\"/g, '"')
                        .replace(/\\\//g, '/')
                        .replace(/\\\\/g, '\\');
                    }
                  }
                }
              }

              finalMarkdown = finalMarkdown.trim();

              if (!finalMarkdown) {
                console.error(
                  '[Canvas Stream] Failed to extract markdown. Message:',
                  JSON.stringify(message)
                );
                throw new Error('Claude から編集後Markdownを受け取れませんでした');
              }

              // ✅ 第3段階: 編集内容の分析（検証結果と修正内容）
              const formatInstructions = shouldEnableWebSearch
                ? [
                    '以下のフォーマットでプレーンテキスト（Markdownの太字・箇条書き・見出しは禁止）として出力してください。',
                    '',
                    '1. 1行目に【検証結果】とだけ記載する。',
                    '2. 2行目に検証結果の本文を記載する（Web検索の判断を含める）。',
                    '3. 次の行は空行を1つ入れる。',
                    '4. 次の行に【主な修正内容】と記載する。',
                    '5. 以降は「削除 - 内容。理由。」「変更 - Before→After。理由。」「追加 - 内容。理由。」の形式で必要な項目だけを記載する。不要な項目は記載しない。',
                    '6. 各行の先頭に余計な記号を付けず、行末で改行する。必要最小限の行数でまとめる。各行の末尾で改行する。',
                  ]
                : [
                    '以下のフォーマットでプレーンテキスト（Markdownの太字・箇条書き・見出しは禁止）として出力してください。',
                    '',
                    '1. 1行目に【主な修正内容】と記載する。',
                    '2. 以降は「削除 - 内容。理由。」「変更 - Before→After。理由。」「追加 - 内容。理由。」の形式で必要な項目だけを記載する。不要な項目は記載しない。',
                    '3. 各行の先頭に余計な記号を付けず、行末で改行する。必要最小限の行数でまとめる。各行の末尾で改行する。',
                  ];

              const analysisSystemPrompt = [
                '# 文章編集内容の分析専門モード',
                '',
                '## あなたの役割',
                '編集前後の文章を比較し、検証結果と主要な変更点を簡潔にまとめます。',
                '',
                '## 出力形式',
                ...formatInstructions,
                '',
                '---',
                '',
                '## 編集前の文章全体',
                '```markdown',
                canvasContent,
                '```',
                '',
                '## 編集後の文章全体',
                '```markdown',
                finalMarkdown,
                '```',
                '',
                '## ユーザーが選択した範囲（この部分を改善した）',
                '```',
                selectedText,
                '```',
                '',
                '## ユーザーの改善指示',
                instruction,
                '',
                ...(searchResults
                  ? [
                      '## Web検索で取得した情報',
                      '```',
                      searchResults,
                      '```',
                      '',
                      extractedReferences.length > 0
                        ? [
                            '## 利用可能な外部リンク（以下のみ参照可）',
                            ...extractedReferences.map(
                              (reference, index) =>
                                `${index + 1}. ${reference.url}${
                                  reference.context ? ` （関連情報: ${reference.context}）` : ''
                                }`
                            ),
                            '',
                            '分析結果では、上記に含まれないURLは言及しないでください。',
                          ].join('\n')
                        : [
                            '## 利用可能な外部リンクはありません',
                            '検証結果では「外部リンクは未掲載」等と明示してください。存在しないドメインを例示してはいけません。',
                          ].join('\n'),
                      '',
                    ]
                  : []),
                '上記の情報を元に、何が変更されたか、なぜ変更したかを分析して、指示したフォーマットのプレーンテキストで出力してください。',
              ]
                .filter(Boolean)
                .join('\n');

              const analysisStream = await anthropic.messages.stream({
                model: actualModel,
                max_tokens: 500, // 簡潔な出力のためトークン数を削減
                temperature: 0.3,
                system: [
                  {
                    type: 'text',
                    text: analysisSystemPrompt,
                    cache_control: { type: 'ephemeral' },
                  },
                ],
                messages: [
                  {
                    role: 'user',
                    content: shouldEnableWebSearch
                      ? '編集内容を分析して、指定したフォーマットで検証結果と主な修正内容をプレーンテキストで出力してください。1行目に【検証結果】、次の行に本文、その次の行で空行を1つ入れ、次の行に【主な修正内容】、以降の行で「削除/変更/追加 - ...」の形式で記載し、各行の末尾で改行してください。Markdownの装飾は禁止です。必要最小限の行数でまとめてください。'
                      : '編集内容を分析して、指定したフォーマットで主な修正内容のみをプレーンテキストで出力してください。1行目に【主な修正内容】、以降の行で「削除/変更/追加 - ...」の形式で記載し、各行の末尾で改行してください。Markdownの装飾は禁止です。必要最小限の行数でまとめてください。',
                  },
                ],
              });

              let analysisResult = '';
              for await (const analysisEvent of analysisStream) {
                if (abortController?.signal.aborted) break;
                resetIdleTimeout();

                if (
                  analysisEvent.type === 'content_block_delta' &&
                  analysisEvent.delta.type === 'text_delta'
                ) {
                  analysisResult += analysisEvent.delta.text;
                  controller.enqueue(
                    sendSSE('analysis_chunk', { content: analysisEvent.delta.text })
                  );
                }
              }

              console.log('[Canvas Analysis] Analysis completed. Length:', analysisResult.length);

              // ✅ チャット履歴に2つのアシスタントメッセージを別々に保存
              // continueChat は必ずユーザーメッセージとアシスタントメッセージのペアを保存するため、
              // 1回だけ呼び出してユーザーメッセージを保存し、2つのアシスタントメッセージは別々に保存する

              // 1つ目: Canvas編集結果（blog_creation_${targetStep}）
              const resolvedStep7HeadingIndex =
                targetStep === HEADING_FLOW_STEP_ID &&
                isHeadingUnit &&
                typeof step7HeadingIndex === 'number' &&
                Number.isInteger(step7HeadingIndex) &&
                step7HeadingIndex >= 0
                  ? step7HeadingIndex
                  : null;
              const canvasModel =
                targetStep === HEADING_FLOW_STEP_ID && resolvedStep7HeadingIndex !== null
                  ? `blog_creation_${targetStep}_h${resolvedStep7HeadingIndex}`
                  : `blog_creation_${targetStep}`;
              const postStreamLimitError = await checkTrialDailyLimit(userRole, userId);
              if (postStreamLimitError) {
                controller.enqueue(
                  sendSSE('error', { type: 'daily_limit', message: postStreamLimitError })
                );
                if (pingInterval) clearInterval(pingInterval);
                cleanup();
                controller.close();
                return;
              }

              // Step7(見出しフロー)完了後の全文Canvas修正は session_combined_contents にも新バージョンとして保存する
              // 副次処理のため、失敗してもチャット履歴保存は継続する
              if (targetStep === HEADING_FLOW_STEP_ID && !isHeadingUnit) {
                try {
                  const sessionCheck = await supabaseService.getChatSessionById(sessionId, userId!);
                  if (!sessionCheck.success || !sessionCheck.data) {
                    console.warn(
                      '[Canvas Stream] Skip combined-content side effect: no session access',
                      {
                        sessionId,
                        userId,
                      }
                    );
                  } else {
                    const sectionsResult = await headingFlowService.getHeadingSections(sessionId);
                    if (!sectionsResult.success) {
                      console.warn('[Canvas Stream] Failed to check heading sections:', {
                        sessionId,
                        error: sectionsResult.error,
                      });
                    } else {
                      const sections = sectionsResult.data;
                      if (!Array.isArray(sections)) {
                        console.warn('[Canvas Stream] Invalid heading sections payload:', {
                          sessionId,
                          sections,
                        });
                      }
                      const isStep6Completed =
                        Array.isArray(sections) &&
                        sections.length > 0 &&
                        sections.every(s => s.is_confirmed);
                      if (isStep6Completed) {
                        const saveCombinedResult =
                          await headingFlowService.saveCombinedContentSnapshot(
                            sessionId,
                            finalMarkdown,
                            userId!
                          );
                        if (!saveCombinedResult.success) {
                          console.warn('[Canvas Stream] Failed to save combined content snapshot:', {
                            sessionId,
                            error: saveCombinedResult.error,
                          });
                        }
                      }
                    }
                  }
                } catch (step6SideEffectError) {
                  console.error('[Canvas Stream] Step7 side effect failed:', {
                    sessionId,
                    error: step6SideEffectError,
                  });
                }
              }

              await chatService.continueChat(
                userId!,
                sessionId,
                [instruction, finalMarkdown],
                '', // systemPromptは履歴に保存しない
                [],
                canvasModel
              );

              // 2つ目: 分析結果（blog_creation_improvement）
              // アシスタントメッセージのみを追加保存（ユーザーメッセージは既に上で保存済み）
              if (analysisResult) {
                const assistantAnalysisMessage = {
                  id: crypto.randomUUID(),
                  user_id: userId!,
                  session_id: sessionId,
                  role: 'assistant' as const,
                  content: analysisResult,
                  model: 'blog_creation_improvement',
                  created_at: new Date(Date.now() + 100).toISOString(), // Canvas編集結果の後に表示されるよう順序を保証（余裕を持たせる）
                };

                // Supabaseに直接保存
                await supabaseService.createChatMessage(assistantAnalysisMessage);
              }

              controller.enqueue(
                sendSSE('done', { fullMarkdown: finalMarkdown, analysis: analysisResult })
              );
            }
          }

          cleanup();
          controller.close();
        } catch (error) {
          cleanup();
          console.error('[Canvas Stream] Error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Canvas編集に失敗しました';
          controller.enqueue(sendSSE('error', { type: 'stream', message: errorMessage }));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[Canvas Stream] Setup error:', error);
    const errorMessage = error instanceof Error ? error.message : '予期せぬエラーが発生しました';
    return new Response(sendSSE('error', { type: 'setup', message: errorMessage }), {
      status: 500,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    });
  }
}
