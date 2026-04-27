import type { ChatMessage } from '@/domain/interfaces/IChatService';
import {
  BLOG_MODEL_PREFIX,
  BLOG_STEP_IDS,
  MIN_LEAD_CONTENT_LENGTH,
  getStep7HeadingModel,
  toBlogModel,
  type BlogStepId,
} from '@/lib/constants';

interface CanvasStructuredContent {
  markdown?: string;
  html?: string;
}

const isBlogStepId = (value: string): value is BlogStepId =>
  BLOG_STEP_IDS.includes(value as BlogStepId);

export const extractBlogStepFromModel = (model?: string): BlogStepId | null => {
  if (!model || !model.startsWith(BLOG_MODEL_PREFIX)) return null;
  const suffix = model.slice(BLOG_MODEL_PREFIX.length);
  // blog_creation_step7_h0 / blog_creation_step5_manual などの拡張サフィックスにも対応
  const matchedStep = suffix.match(/^(step[1-7])(?:_|$)/)?.[1];
  return matchedStep && isBlogStepId(matchedStep) ? (matchedStep as BlogStepId) : null;
};

export const extractStep7HeadingIndexFromModel = (model?: string): number | null => {
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
    if (contentLen < MIN_LEAD_CONTENT_LENGTH) continue;
    const modelStep = extractBlogStepFromModel(message.model);
    if (!modelStep) continue;
    return modelStep;
  }
  return null;
};

/** 構成案（基本構成）の先頭パターン。step5 出力と step6 書き出し案を区別する */
export const BASIC_STRUCTURE_PATTERN =
  /基本構成|【基本構成|構成案（記事全体|記事全体の設計図/;

/**
 * ブログ作成フロー: リクエストモデル(stepN)に対して、応答内容が属するステップのモデルを返す。
 * 1:1 マッピング: request stepN → response は stepN で保存。
 */
export const getResponseModelForBlogCreation = (requestModel: string): string => {
  const match = requestModel.match(new RegExp(`^${BLOG_MODEL_PREFIX}step(\\d+)$`));
  if (!match?.[1]) return requestModel;
  const step = Number.parseInt(match[1], 10);
  if (step < 1 || step > 7) return requestModel;
  return toBlogModel(BLOG_STEP_IDS[step - 1] as BlogStepId);
};

/**
 * Canvas で編集したコンテンツを保存する際に使用するモデルを返す。
 * 1:1 マッピング: 表示 stepN → 保存 model stepN。step7 見出し単位のみ _hN サフィックス。
 */
export const getSaveModelForCanvasStep = (
  canvasStep: BlogStepId,
  step7HeadingIndex?: number | null
): string => {
  const num = Number.parseInt(canvasStep.replace(/^step/, ''), 10);
  if (Number.isNaN(num) || num < 1 || num > 7) return toBlogModel(canvasStep);
  if (num === 7) {
    if (step7HeadingIndex != null && Number.isInteger(step7HeadingIndex) && step7HeadingIndex >= 0) {
      return getStep7HeadingModel(step7HeadingIndex);
    }
  }
  return toBlogModel(canvasStep);
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
  findLatestAssistantBlogStep,
  normalizeCanvasContent,
  htmlToMarkdownForCanvas,
  sanitizeHtmlForCanvas,
  isBlogStepId,
};
