import type { ChatMessage } from '@/domain/interfaces/IChatService';
import { BLOG_STEP_IDS, type BlogStepId } from '@/lib/constants';

const BLOG_MODEL_PREFIX = 'blog_creation_';

export interface CanvasStructuredContent {
  markdown?: string;
  html?: string;
}

const isBlogStepId = (value: string): value is BlogStepId =>
  BLOG_STEP_IDS.includes(value as BlogStepId);

const extractBlogStepFromModel = (model?: string): BlogStepId | null => {
  if (!model || !model.startsWith(BLOG_MODEL_PREFIX)) return null;
  const suffix = model.slice(BLOG_MODEL_PREFIX.length);
  // blog_creation_step7_h0 / blog_creation_step5_manual などの拡張サフィックスにも対応
  const matchedStep = suffix.match(/^(step[1-7])(?:_|$)/)?.[1];
  return matchedStep && isBlogStepId(matchedStep) ? (matchedStep as BlogStepId) : null;
};

const extractStep7HeadingIndexFromModel = (model?: string): number | null => {
  if (!model) return null;
  const pattern = new RegExp(`^${BLOG_MODEL_PREFIX}step7_h(\\d+)(?:_|$)`);
  const match = model.match(pattern);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const findLatestAssistantBlogStep = (messages: ChatMessage[]): BlogStepId | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    const contentLen = (message.content ?? '').trim().length;
    // ストリーミング中は空の assistant をスキップ（step6 リクエスト後に step7 の空メッセージが即追加され、書き出し案到着前に step7 表示になるのを防ぐ）
    if (contentLen < 20) continue;
    let modelStep = extractBlogStepFromModel(message.model);
    if (!modelStep) continue;
    // 補正: step7 で誤保存された 構成案（基本構成）は model step6 相当
    const contentHead = (message.content ?? '').slice(0, 150);
    if (
      modelStep === 'step7' &&
      /基本構成|【基本構成|構成案（記事全体|記事全体の設計図/.test(contentHead)
    ) {
      modelStep = 'step6';
    }
    // 表示用: model stepN は response 保存形式のため、コンテンツが属する step に変換
    // (step1 出力は blog_creation_step2 で保存 → 表示は step1)
    return getContentStepFromAssistantModel(message.model, message.content ?? undefined) ?? modelStep;
  }
  return null;
};

const BASIC_STRUCTURE_PATTERN =
  /基本構成|【基本構成|構成案（記事全体|記事全体の設計図/;

/**
 * assistant メッセージの model から、そのコンテンツが属する表示用ステップを返す。
 * getResponseModelForBlogCreation により request stepN → response stepN+1 で保存される。
 * 表示用: コンテンツが属するステップ（request stepN の出力なら表示は stepN）。
 * @param content 省略可。指定時は 構成案/書き出し案 の区別に使用
 */
export const getContentStepFromAssistantModel = (
  model?: string,
  content?: string
): BlogStepId | null => {
  const modelStep = extractBlogStepFromModel(model);
  if (!modelStep) return null;
  const num = Number.parseInt(modelStep.replace(/^step/, ''), 10);
  if (Number.isNaN(num) || num < 1 || num > 7) return modelStep;
  if (num === 1) return modelStep;
  if (num === 7) {
    // step7_h0 等は見出し本文 → step7
    if (/^blog_creation_step7_h\d+/.test(model ?? '')) return modelStep;
    // blog_creation_step7（プレーンのみ）: 構成案 or 記事本文
    if (content !== undefined) {
      const head = content.slice(0, 150);
      if (BASIC_STRUCTURE_PATTERN.test(head)) return 'step5'; // 構成案
      return modelStep; // 記事本文 → step7
    }
    return modelStep; // content なし時は従来どおり
  }
  // step2〜6: request stepN → response model stepN+1 のため、表示は stepN（出力元）
  // step6 のみ例外: 構成案(step5出力)か書き出し案(step6出力)で content 判定
  if (num === 6) {
    if (content !== undefined) {
      const head = content.slice(0, 150);
      if (BASIC_STRUCTURE_PATTERN.test(head)) return 'step5'; // 構成案
    }
    return 'step6'; // 書き出し案（content 未指定時もデフォルト）
  }
  // step2〜5: model stepN = 出力元は stepN-1
  const displayNum = num - 1;
  const stepId = `step${displayNum}` as BlogStepId;
  return BLOG_STEP_IDS.includes(stepId) ? stepId : modelStep;
};

/**
 * ブログ作成フロー: リクエストモデル(stepN)に対して、応答内容が属する次のステップのモデルを返す。
 * step5構成案送信 → 書き出し案(step6)が返るため、assistantメッセージは blog_creation_step6 で保存する。
 */
export const getResponseModelForBlogCreation = (requestModel: string): string => {
  const match = requestModel.match(/^blog_creation_step(\d+)$/);
  if (!match?.[1]) return requestModel;
  const step = Number.parseInt(match[1], 10);
  if (step < 1 || step >= 7) return requestModel;
  return `blog_creation_step${step + 1}`;
};

const extractCanvasStructuredContent = (raw: string): CanvasStructuredContent | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const jsonCandidate = (fencedMatch?.[1] ?? trimmed).trim();
  const startsWithObject = jsonCandidate.trim().startsWith('{');
  const startsWithArray = jsonCandidate.trim().startsWith('[');
  const start = jsonCandidate.indexOf(startsWithArray ? '[' : '{');
  const end = jsonCandidate.lastIndexOf(startsWithArray ? ']' : '}');

  if (!startsWithObject && !startsWithArray) {
    return null;
  }

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonCandidate.slice(start, end + 1));
    const markdownCandidate =
      parsed.markdown ?? parsed.full_markdown ?? parsed.canvas_markdown ?? null;
    const htmlCandidate =
      parsed.replacement_html ?? parsed.replacement ?? parsed.full_html ?? parsed.html ?? null;

    const result: CanvasStructuredContent = {};

    if (typeof markdownCandidate === 'string' && markdownCandidate.trim().length > 0) {
      result.markdown = markdownCandidate.trim();
    }

    if (typeof htmlCandidate === 'string' && htmlCandidate.trim().length > 0) {
      result.html = htmlCandidate.trim();
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (error) {
    console.warn('Failed to parse canvas version JSON:', error);
  }

  return null;
};

const sanitizeHtmlForCanvas = (html: string): string => {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(iframe|noscript|svg|canvas|form|input|button)[^>]*>/gi, '')
    .replace(/\r\n/g, '\n');
};

const htmlToMarkdownForCanvas = (html: string): string => {
  const sanitized = sanitizeHtmlForCanvas(html);
  return (
    sanitized
      .replace(/<\/?(article|section|main|header|footer)[^>]*>/gi, '\n')
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, content) => `# ${content.trim()}\n\n`)
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, content) => `## ${content.trim()}\n\n`)
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, content) => `### ${content.trim()}\n\n`)
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, content) => `#### ${content.trim()}\n\n`)
      .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, content) => `##### ${content.trim()}\n\n`)
      .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, content) => `###### ${content.trim()}\n\n`)
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, content) => `**${content.trim()}**`)
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, content) => `**${content.trim()}**`)
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, content) => `*${content.trim()}*`)
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, content) => `*${content.trim()}*`)
      .replace(
        /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
        (_, content) => `\`\`\`\n${content.trim()}\n\`\`\`\n\n`
      )
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => `\`${content.trim()}\``)
      .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_: string, content: string) =>
        content
          .split('\n')
          .map((line: string) => line.trim())
          .filter(Boolean)
          .map((line: string) => `> ${line}`)
          .join('\n')
      )
      .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) =>
        content
          .replace(/<\/li>\s*<li/gi, '</li>\n<li')
          .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
            const trimmed = item.trim();
            return trimmed ? `- ${trimmed}\n` : '';
          })
      )
      .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
        let counter = 1;
        return content
          .replace(/<\/li>\s*<li/gi, '</li>\n<li')
          .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
            const trimmed = item.trim();
            return trimmed ? `${counter++}. ${trimmed}\n` : '';
          });
      })
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
        const label = (text || '').trim();
        const url = (href || '').trim();
        if (!label || !url) return label || url || '';
        return `[${label}](${url})`;
      })
      .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, (_, src, alt) => {
        const altText = (alt || '').trim();
        const url = (src || '').trim();
        return url ? `![${altText}](${url})` : '';
      })
      .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (_, src) => {
        const url = (src || '').trim();
        return url ? `![](${url})` : '';
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p[^>]*>/gi, '')
      // spanは見出しやインライン要素のラッパーとして使われるため改行に置換せず除去のみ行う
      .replace(/<\/?span[^>]*>/gi, '')
      .replace(/<\/?(div|figure|figcaption)[^>]*>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
  );
};

const normalizeCanvasContent = (raw: string): string => {
  if (!raw) return '';
  const structured = extractCanvasStructuredContent(raw);
  if (!structured) {
    if (/^\s*</.test(raw.trim())) {
      return htmlToMarkdownForCanvas(raw);
    }
    return raw;
  }
  if (structured.markdown) {
    return structured.markdown;
  }
  if (structured.html) {
    return htmlToMarkdownForCanvas(structured.html);
  }
  return raw;
};

export {
  extractBlogStepFromModel,
  extractStep7HeadingIndexFromModel,
  findLatestAssistantBlogStep,
  normalizeCanvasContent,
  htmlToMarkdownForCanvas,
  sanitizeHtmlForCanvas,
  isBlogStepId,
};
