const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
};

function decodeEntity(entity: string): string {
  const numeric = entity.match(/^#(x[0-9a-f]+|[0-9]+)$/i);
  if (numeric) {
    const value = numeric[1];
    if (!value) return `&${entity};`;
    const codePoint = value.toLowerCase().startsWith('x')
      ? Number.parseInt(value.slice(1), 16)
      : Number.parseInt(value, 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : `&${entity};`;
  }
  return HTML_ENTITY_MAP[entity.toLowerCase()] ?? `&${entity};`;
}

export function normalizeContentText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, (_, entity: string) => decodeEntity(entity))
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * 期待読了時間の元になる本文文字数。
 *
 * 受領仕様（`docs/context/ga4-evaluation-engine-spec-20260817.md` §09 実装チェック）は
 * verbatim で「記事本文の文字数をツールのDBから取得（**HTMLタグ・空白を除いた本文のみ**）」
 * と定める。HTML タグは取込側（`wordpressService` の `stripHtml`）で既に落ちているが、
 * 空白は `normalizeContentText` が1個へ畳むだけで残っていたため、ここで除去する。
 *
 * 空白を数えると 文字数 → 期待読了時間 → 読了率 → コンテンツ力スコア と伝播して
 * スコアが実際より低く出る。日本語主体の記事では差は小さいが、英数字や
 * コードブロックを多く含む記事では無視できない。
 */
export function countContentChars(value: string | null | undefined): number {
  return Array.from(normalizeContentText(value).replace(/\s/gu, '')).length;
}

export function countImageTags(value: string | null | undefined): number {
  if (!value) return 0;
  return value.match(/<img\b/giu)?.length ?? 0;
}
