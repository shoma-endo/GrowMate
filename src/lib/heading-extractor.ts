/**
 * Extract H3 and H4 headings from markdown text.
 */
export interface ExtractedHeading {
  text: string;
  level: 3 | 4;
  orderIndex: number;
}

/**
 * Step 5の構成案テキストから、H3およびH4の見出しを抽出する。
 * コードブロック内や、その他のレベルの見出しは無視する。
 */
export function extractHeadingsFromMarkdown(markdown: string): ExtractedHeading[] {
  if (!markdown) return [];

  const lines = markdown.split('\n');
  const headings: ExtractedHeading[] = [];
  let inCodeBlock = false;
  let orderIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // コードブロックの開始/終了を検知
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // H3 (###) または H4 (####) の見出しにマッチ
    // 正規表現: 行頭から # が 3〜4 つ続き、その後に空白、そして見出しテキスト
    const match = trimmed.match(/^(#{3,4})\s+(.+)$/);
    if (match) {
      const hashes = match[1] || '';
      const text = (match[2] || '').trim();

      // 空の見出しは除外
      if (text) {
        const level = hashes.length as 3 | 4;
        headings.push({
          text,
          level,
          orderIndex: orderIndex++,
        });
      }
    }
  }

  return headings;
}

/**
 * 見出しの識別子（heading_key）を生成する。
 * 形式: {order_index}:{normalized_heading_text}:{short_hash}
 *
 * 設計上の注意: 見出しテキストが変わるとキーが変わり、既存DBレコードとの紐付けが切れる。
 * (session_id, heading_key) の UNIQUE 制約により、step5 を微修正した場合は新規セクション扱いになる。
 * 将来的にテキスト微修正（誤字等）への耐性が必要な場合は、orderIndex のみをキーにする方式の検討を推奨。
 */
export function generateHeadingKey(orderIndex: number, headingText: string): string {
  const normalizedText = headingText
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const hash = simpleHash(headingText);
  return `${orderIndex}:${normalizedText}:${hash}`;
}

/**
 * 文字列から短いハッシュ（4文字のBase36）を生成する。
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    // int32に切り詰めてオーバーフローを防ぐ
    hash = (hash << 5) - hash + char;
    hash = hash | 0;
  }
  // Base36に変換し、衝突回避のために絶対値を使用
  return Math.abs(hash).toString(36).slice(0, 4).padStart(4, '0');
}
