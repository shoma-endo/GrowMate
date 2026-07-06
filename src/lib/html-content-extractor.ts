import { parse } from 'node-html-parser';

import { extractHeadingsFromMarkdown } from '@/lib/heading-extractor';

const HEADING_SELECTOR = 'h2, h3, h4';

function normalizeHeadingText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * WordPress 生 HTML から h2/h3/h4 見出しを出現順に抽出し、
 * basic_structure 保存形式（`h2 見出し` 行連結）に整形する。
 */
export function extractBasicStructureFromHtml(html: string): string {
  if (!html.trim()) {
    return '';
  }

  const root = parse(html);
  const elements = root.querySelectorAll(HEADING_SELECTOR);
  const lines: string[] = [];

  for (const element of elements) {
    const tagName = element.tagName?.toLowerCase();
    if (tagName !== 'h2' && tagName !== 'h3' && tagName !== 'h4') {
      continue;
    }

    const text = normalizeHeadingText(element.text);
    if (!text) {
      continue;
    }

    lines.push(`${tagName} ${text}`);
  }

  const basicStructure = lines.join('\n');
  extractHeadingsFromMarkdown(basicStructure);
  return basicStructure;
}
