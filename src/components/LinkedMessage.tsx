import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * メッセージ内の特定フレーズをリンクに変換するルール。
 *
 * @property phrase - リンク化する文字列。大文字小文字を区別します。
 * @property href - リンク先URL。内部リンクのみ許可するため、'/' で始まる必要があります。
 * @property variant - リンクの表示スタイル。未指定時は 'text-link' です。
 * @property target - リンクの開き方。未指定時は '_blank'（別タブ）。
 *   現状の利用は再連携・インポート等「離脱して戻る」導線のため別タブを既定とする。
 *   同一タブ遷移にしたい場合のみ '_self' を指定する。
 */
export interface LinkedMessageRule {
  phrase: string;
  href: string;
  variant?: 'text-link' | 'button-link';
  target?: '_self' | '_blank';
}

interface LinkedMessageProps {
  message: string;
  rules: LinkedMessageRule[];
}

type MessageSegment =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'link';
      text: string;
      href: string;
      variant: NonNullable<LinkedMessageRule['variant']>;
      target: NonNullable<LinkedMessageRule['target']>;
    };

function buildSegments(message: string, rules: LinkedMessageRule[]): MessageSegment[] {
  const segments: MessageSegment[] = [{ kind: 'text', text: message }];

  for (const rule of rules) {
    const phrase = rule.phrase.trim();
    if (!phrase || !rule.href.startsWith('/')) {
      if (process.env.NODE_ENV === 'development' && rule.href && !rule.href.startsWith('/')) {
        console.warn(
          `LinkedMessage: External links are not supported. Skipping rule for phrase "${phrase}".`
        );
      }
      continue;
    }

    const nextSegments: MessageSegment[] = [];
    for (const segment of segments) {
      if (segment.kind === 'link' || !segment.text.includes(phrase)) {
        nextSegments.push(segment);
        continue;
      }

      const parts = segment.text.split(phrase);
      parts.forEach((part, index) => {
        if (part) {
          nextSegments.push({ kind: 'text', text: part });
        }
        if (index < parts.length - 1) {
          nextSegments.push({
            kind: 'link',
            text: phrase,
            href: rule.href,
            variant: rule.variant ?? 'text-link',
            target: rule.target ?? '_blank',
          });
        }
      });
    }
    segments.splice(0, segments.length, ...nextSegments);
  }

  return segments;
}

export function LinkedMessage({ message, rules }: LinkedMessageProps) {
  const segments = buildSegments(message, rules);

  if (segments.length === 1 && segments[0]?.kind === 'text') {
    return <>{message}</>;
  }

  return (
    <>
      {segments.map((segment, index) => {
        const key = `${segment.kind}-${index}-${segment.kind === 'text' ? segment.text : segment.href}`;
        if (segment.kind === 'text') {
          return <span key={key}>{segment.text}</span>;
        }

        // 別タブ（_blank）時のみ rel を付与（逆タブナビ・リファラ漏れ対策）。
        const targetProps =
          segment.target === '_blank'
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : { target: '_self' };

        if (segment.variant === 'button-link') {
          return (
            <Button key={key} variant="link" asChild className="h-auto px-1 py-0">
              <Link href={segment.href} {...targetProps}>
                {segment.text}
              </Link>
            </Button>
          );
        }

        return (
          <Link
            key={key}
            href={segment.href}
            className="text-primary underline-offset-4 hover:underline"
            {...targetProps}
          >
            {segment.text}
          </Link>
        );
      })}
    </>
  );
}
