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

export function countContentChars(value: string | null | undefined): number {
  return Array.from(normalizeContentText(value)).length;
}

export function countImageTags(value: string | null | undefined): number {
  if (!value) return 0;
  return value.match(/<img\b/giu)?.length ?? 0;
}
