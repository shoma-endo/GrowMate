'use client';

import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '@/domain/interfaces/IChatService';
import { Bot } from 'lucide-react';
import { cn, normalizeForHeadingMatch } from '@/lib/utils';
import BlogPreviewTile from './common/BlogPreviewTile';
import { BLOG_STEP_LABELS } from '@/lib/constants';
import type { BlogStepId } from '@/lib/constants';
import {
  extractBlogStepFromModel,
  extractStep7HeadingIndexFromModel,
  normalizeCanvasContent,
} from '@/lib/canvas-content';
import { MARKDOWN_HEADING_REGEX } from '@/lib/heading-extractor';
import type { SessionHeadingSection } from '@/types/heading-flow';

interface BlogPreviewMeta {
  step: BlogStepId;
  title: string | null;
  excerpt: string | null;
}

const URL_SAFE_CHAR_SET = new Set<string>([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  '-', '.', '_', '~', ':', '/', '?', '#', '[', ']', '@',
  '!', '$', '&', "'", '(', ')', '*', '+', ',', ';', '=', '%',
]);

const TRIMMABLE_TRAILING_CHAR_SET = new Set<string>([
  '.', ',', '!', '?', ';', ':', '、', '。', '，', '．', '）', '】', '〉', '》', '」', '』',
]);

const isUrlSafeChar = (char: string) => URL_SAFE_CHAR_SET.has(char);
const isTrimmableTrailingChar = (char: string) => TRIMMABLE_TRAILING_CHAR_SET.has(char);

interface MessageAreaProps {
  messages: ChatMessage[];
  isLoading: boolean;
  renderAfterMessage?: (message: ChatMessage) => React.ReactNode;
  blogFlowActive?: boolean;
  onOpenCanvas?: (message: ChatMessage) => void;
  headingSections?: SessionHeadingSection[];
}

// 末尾句読点・全角コロン等を除去して照合用に正規化
const getStep7HeadingLabel = (
  message: ChatMessage,
  sections: SessionHeadingSection[],
  step7MessageIndex: number,
  step7Total: number
): string | null => {
  const normalized = normalizeCanvasContent(message.content ?? '').trim();

  if (sections.length > 0) {
    // 新方式: model に埋め込まれた見出しインデックスを最優先で使用
    const indexedHeading = extractStep7HeadingIndexFromModel(message.model);
    if (indexedHeading !== null && indexedHeading >= 0 && indexedHeading < sections.length) {
      const section = sections[indexedHeading]!;
      return `見出し ${section.orderIndex + 1}/${sections.length}：「${section.headingText}」`;
    }
    // 旧データ互換: 本文中の見出し行から推測
    for (const line of normalized.split('\n')) {
      const match = line.trim().match(MARKDOWN_HEADING_REGEX);
      if (match?.[1]) {
        const headingText = normalizeForHeadingMatch(match[1]);
        const matched = sections.filter(
          s => normalizeForHeadingMatch(s.headingText) === headingText
        );
        if (matched.length === 1) {
          const section = matched[0]!;
          return `見出し ${section.orderIndex + 1}/${sections.length}：「${section.headingText}」`;
        }
        if (matched.length > 1) {
          // 重複見出しは step7 メッセージ順に最も近い orderIndex を選ぶ
          const best = matched.reduce((prev, curr) =>
            Math.abs(curr.orderIndex - step7MessageIndex) <
            Math.abs(prev.orderIndex - step7MessageIndex)
              ? curr
              : prev
          );
          return `見出し ${best.orderIndex + 1}/${sections.length}：「${best.headingText}」`;
        }
      }
    }
    // 旧/通常経路互換: model や本文から特定できない場合は step7 メッセージ順で補完
    if (step7MessageIndex >= 0 && step7MessageIndex < sections.length) {
      const section = sections[step7MessageIndex]!;
      return `見出し ${section.orderIndex + 1}/${sections.length}：「${section.headingText}」`;
    }
  }

  // フォールバック: headingSections が空（session_headings 未初期化等）でも本文から見出しを抽出して表示
  for (const line of normalized.split('\n')) {
    const match = line.trim().match(MARKDOWN_HEADING_REGEX);
    if (match?.[1]) {
      const headingText = (match[1] ?? '').trim();
      if (headingText) {
        return `見出し ${step7MessageIndex + 1}/${step7Total}：「${headingText}」`;
      }
    }
  }
  // 見出し行がなければメッセージ順のみ表示
  if (step7MessageIndex >= 0) {
    return `見出し ${step7MessageIndex + 1}/${step7Total}`;
  }
  return null;
};

const MessageArea: React.FC<MessageAreaProps> = ({
  messages,
  isLoading,
  renderAfterMessage,
  onOpenCanvas,
  headingSections,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // メッセージが追加されたときに自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTime = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const shouldShowTimestamp = (index: number) => {
    if (index === messages.length - 1) return true;
    if (index < 0 || index >= messages.length - 1) return false;

    const currentMsg = messages[index];
    const nextMsg = messages[index + 1];

    if (!currentMsg || !nextMsg) return true;

    return (
      currentMsg.role !== nextMsg.role ||
      !currentMsg.timestamp ||
      !nextMsg.timestamp ||
      nextMsg.timestamp.getTime() - currentMsg.timestamp.getTime() > 5 * 60 * 1000
    );
  };

  // URL/Markdownリンクを検出してリンクに変換（hrefは純粋なURLのみ）
  const formatMessageContent = (content: string) => {
    const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    const rawUrlPattern =
      /https?:\/\/[^\s)\]「」『』【】〈〉《》〔〕（）<>→、。？！；：・…]+/g;
    const lines = content.split('\n');
    const processed: React.ReactNode[] = [];

    const splitUrlAndTrailing = (value: string) => {
      if (!value) {
        return { href: '', trailing: '' };
      }

      let firstUnsafeIndex = value.length;
      for (let index = 0; index < value.length; index += 1) {
        const char = value[index]!;
        if (!isUrlSafeChar(char)) {
          firstUnsafeIndex = index;
          break;
        }
      }

      let href = value.slice(0, firstUnsafeIndex);
      let trailing = value.slice(firstUnsafeIndex);

      while (href) {
        const lastChar = href[href.length - 1]!;
        if (
          !isUrlSafeChar(lastChar) ||
          isTrimmableTrailingChar(lastChar) ||
          (lastChar === ')' && href.lastIndexOf('(') === -1)
        ) {
          trailing = `${lastChar}${trailing}`;
          href = href.slice(0, -1);
          continue;
        }
        break;
      }

      return { href, trailing };
    };

    const renderLine = (line: string, lineIndex: number) => {
      if (!line) return [];

      const nodes: React.ReactNode[] = [];
      let cursor = 0;
      let match: RegExpExecArray | null;

      markdownLinkPattern.lastIndex = 0;
      while ((match = markdownLinkPattern.exec(line)) !== null) {
        const [fullMatch, label, href] = match;
        const matchedHref = href ?? '';
        const start = match.index;
        if (start > cursor) {
          nodes.push(<span key={`text-${lineIndex}-${cursor}`}>{line.slice(cursor, start)}</span>);
        }
        const { href: trimmedHref, trailing } = splitUrlAndTrailing(matchedHref);

        if (trimmedHref) {
          nodes.push(
            <a
              key={`md-${lineIndex}-${start}`}
              href={trimmedHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {label}
            </a>
          );

          if (trailing) {
            nodes.push(
              <span key={`md-trail-${lineIndex}-${start + trimmedHref.length}`}>{trailing}</span>
            );
          }
        } else {
          nodes.push(
            <span key={`md-text-${lineIndex}-${start}`}>{line.slice(start, start + fullMatch.length)}</span>
          );
        }
        cursor = start + fullMatch.length;
      }

      const remainder = line.slice(cursor);
      if (remainder) {
        let rawCursor = 0;
        rawUrlPattern.lastIndex = 0;
        let rawMatch: RegExpExecArray | null;
        while ((rawMatch = rawUrlPattern.exec(remainder)) !== null) {
          const start = rawMatch.index;
          const end = start + rawMatch[0].length;
          if (start > rawCursor) {
            nodes.push(
              <span key={`text-${lineIndex}-${cursor + rawCursor}`}>
                {remainder.slice(rawCursor, start)}
              </span>
            );
          }

          const originalUrl = rawMatch[0];
          const { href, trailing } = splitUrlAndTrailing(originalUrl);

          if (href) {
            nodes.push(
              <a
                key={`url-${lineIndex}-${cursor + start}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline break-all"
              >
                {href}
              </a>
            );

            if (trailing) {
              nodes.push(<span key={`trail-${lineIndex}-${cursor + end}`}>{trailing}</span>);
            }
          } else {
            nodes.push(
              <span key={`url-text-${lineIndex}-${cursor + start}`}>{originalUrl}</span>
            );
          }

          rawCursor = end;
        }

        if (rawCursor < remainder.length) {
          nodes.push(
            <span key={`tail-${lineIndex}-${cursor + rawCursor}`}>
              {remainder.slice(rawCursor)}
            </span>
          );
        }
      }

      return nodes;
    };

    lines.forEach((line, index) => {
      processed.push(...renderLine(line, index));
      if (index < lines.length - 1) {
        processed.push(<br key={`br-${index}`} />);
      }
    });

    return processed;
  };

  // blog_creation_***モデルで生成されたメッセージかチェック
  const isBlogMessage = (message: ChatMessage): boolean => {
    return message.role === 'assistant' && extractBlogStepFromModel(message.model) !== null;
  };

  const derivePreviewMeta = (message: ChatMessage): BlogPreviewMeta | null => {
    const step = extractBlogStepFromModel(message.model);
    if (!step) return null;

    const normalized = normalizeCanvasContent(message.content ?? '').trim();
    if (!normalized) {
      return {
        step,
        title: null,
        excerpt: null,
      };
    }

    const rawLines = normalized.split('\n');
    const headingIndex = rawLines.findIndex(line => /^#+\s*/.test(line.trim()));
    const firstContentIndex = rawLines.findIndex(line => line.trim().length > 0);
    const titleSourceIndex = headingIndex >= 0 ? headingIndex : firstContentIndex;
    const titleLine =
      titleSourceIndex >= 0 && titleSourceIndex < rawLines.length
        ? rawLines[titleSourceIndex]
        : rawLines[0] ?? '';
    const titleSource = (titleLine ?? '').trim();
    const titleCandidate = titleSource.replace(/^#+\s*/, '').trim();

    const bodyLines = rawLines.filter((_, index) => index !== headingIndex);
    const bodyForDisplay = bodyLines.join('\n').trim();

    const plainExcerptSource = bodyForDisplay || normalized;
    const excerptPlain = plainExcerptSource
      .split('\n')
      .map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^[0-9]+\.\s+/, ''))
      .filter(Boolean)
      .join(' ');

    const excerptCandidate =
      excerptPlain.length > 140 ? `${excerptPlain.slice(0, 140)}…` : excerptPlain;

    return {
      step,
      title: titleCandidate || null,
      excerpt: excerptCandidate || null,
    };
  };

  const Dots: React.FC<{ size?: 'sm' | 'md'; colorClass?: string }> = ({
    size = 'md',
    colorClass = 'bg-[#06c755]',
  }) => {
    const dim = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';
    return (
      <div className="flex gap-2 items-center">
        <div
          className={`${dim} ${colorClass} rounded-full animate-bounce`}
          style={{ animationDelay: '0ms' }}
        />
        <div
          className={`${dim} ${colorClass} rounded-full animate-bounce`}
          style={{ animationDelay: '200ms' }}
        />
        <div
          className={`${dim} ${colorClass} rounded-full animate-bounce`}
          style={{ animationDelay: '400ms' }}
        />
      </div>
    );
  };

  const ActivityIndicator: React.FC<{ variant: 'full' | 'inline'; label?: string }> = ({
    variant,
    label,
  }) => {
    if (variant === 'inline') {
      return (
        <div className="flex items-start gap-2 mb-3 animate-in fade-in">
          <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white border border-gray-200">
            <Bot size={18} className="text-[#06c755]" />
          </div>
          <div className="bg-white text-foreground p-3 rounded-2xl border border-gray-100">
            <div className="flex gap-2 items-center">
              <Dots size="sm" />
              <span className="text-sm text-gray-500">{label ?? 'メッセージを取得中です...'}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="bg-white p-6 rounded-xl shadow-sm flex flex-col items-center">
          <div className="w-10 h-10 rounded-full bg-[#06c755] flex items-center justify-center mb-4">
            <Bot size={24} className="text-white" />
          </div>
          <h3 className="text-lg font-medium mb-3">{label ?? 'メッセージを取得中です'}</h3>
          <Dots size="md" />
        </div>
      </div>
    );
  };

  const EmptyState = () => {
    // 通常の空状態
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <Bot size={48} className="text-gray-300 mb-3" />
        <h3 className="text-lg font-medium mb-1">AIアシスタントへようこそ</h3>
        <p className="text-sm text-gray-500 max-w-xs whitespace-nowrap">
          Google広告の効果を最大化するお手伝いをします。
        </p>
      </div>
    );
  };

  // step7 アシスタントメッセージの ID 一覧（時系列順）。重複見出し照合に使用
  const step7MessageIds = messages
    .filter(m => m.role === 'assistant' && extractBlogStepFromModel(m.model) === 'step7')
    .map(m => m.id);

  return (
    <div className="flex-1 overflow-y-auto p-3 bg-slate-100">
      {isLoading && messages.length === 0 ? (
        <ActivityIndicator variant="full" label="メッセージを取得中です" />
      ) : messages.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {messages.map((message, index) => {
            const blogPreviewMeta = isBlogMessage(message) ? derivePreviewMeta(message) : null;
            const openHandler =
              blogPreviewMeta && onOpenCanvas ? () => onOpenCanvas(message) : null;
            const step7Index = step7MessageIds.indexOf(message.id);
            const headingLabel =
              blogPreviewMeta?.step === 'step7' && step7Index >= 0
                ? getStep7HeadingLabel(
                    message,
                    headingSections ?? [],
                    step7Index,
                    step7MessageIds.length
                  )
                : null;

            return (
              <React.Fragment key={message.id || index}>
                <div className="mb-4 last:mb-2 group">
                  <div
                    className={cn(
                      'flex items-start gap-2 relative',
                      message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                    )}
                  >
                    {message.role !== 'user' && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white border border-gray-200">
                        <Bot size={18} className="text-[#06c755]" />
                      </div>
                    )}
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl relative transition-all duration-200',
                        message.role === 'user'
                          ? 'bg-[#06c755] text-white p-3'
                          : blogPreviewMeta
                            ? 'bg-transparent text-gray-800 p-0'
                            : 'bg-white text-gray-800 border border-gray-100 p-3'
                      )}
                    >
                      {blogPreviewMeta ? (
                        <BlogPreviewTile
                          stepLabel={BLOG_STEP_LABELS[blogPreviewMeta.step] ?? 'ブログ'}
                          headingLabel={headingLabel}
                          title={blogPreviewMeta.title}
                          excerpt={blogPreviewMeta.excerpt}
                          {...(openHandler ? { onOpen: openHandler } : {})}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap text-sm">
                          {formatMessageContent(message.content)}
                        </div>
                      )}
                    </div>
                    {message.role === 'user' && <div className="opacity-0 w-8 h-8" />}
                  </div>

                  {shouldShowTimestamp(index) && (
                    <div
                      className={cn(
                        'text-[10px] text-gray-400 mt-1 px-2',
                        message.role === 'user' ? 'text-right' : 'text-left'
                      )}
                    >
                      {formatTime(message.timestamp)}
                    </div>
                  )}
                </div>
                {renderAfterMessage?.(message)}
              </React.Fragment>
            );
          })}

          <div ref={messagesEndRef} />

          {isLoading && <ActivityIndicator variant="inline" label="メッセージを取得中です..." />}
        </>
      )}
    </div>
  );
};

export default MessageArea;
