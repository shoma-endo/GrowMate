import { parse, type HTMLElement } from 'node-html-parser';

import { extractHeadingsFromMarkdown } from '@/lib/heading-extractor';

const HEADING_SELECTOR = 'h2, h3, h4';
const OPENING_CONTENT_SELECTOR = 'p, ul, ol';

function normalizeElementText(text: string): string {
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

    const text = normalizeElementText(element.text);
    if (!text) {
      continue;
    }

    lines.push(`${tagName} ${text}`);
  }

  const basicStructure = lines.join('\n');
  extractHeadingsFromMarkdown(basicStructure);
  return basicStructure;
}

/**
 * WordPress 生 HTML の本文冒頭から最初の h2 直前までにある p・リスト要素を抽出し、
 * 原文のブロックを空行で連結する。最初の h2 がない場合は抽出範囲を確定できないため空文字を返す。
 */
export function extractOpeningProposalFromHtml(html: string): string {
  if (!html.trim()) {
    return '';
  }

  const root = parse(html);
  const firstH2 = root.querySelector('h2');
  if (!firstH2) {
    return '';
  }

  const firstH2Start = firstH2.range[0];
  const blocks: string[] = [];

  for (const element of root.querySelectorAll(OPENING_CONTENT_SELECTOR)) {
    if (element.range[0] >= firstH2Start) {
      continue;
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'p') {
      if (element.closest('li')) {
        continue;
      }

      const text = normalizeElementText(element.text);
      if (text) {
        blocks.push(text);
      }
      continue;
    }

    const listItems = element.children.filter(child => child.tagName.toLowerCase() === 'li');
    const lines = listItems.flatMap((item, index) => {
      const itemWithoutNestedLists = item.clone() as HTMLElement;
      for (const nestedList of itemWithoutNestedLists.querySelectorAll('ul, ol')) {
        nestedList.remove();
      }

      const text = normalizeElementText(itemWithoutNestedLists.text);
      if (!text) {
        return [];
      }

      return [`${tagName === 'ol' ? `${index + 1}.` : '・'}${text}`];
    });
    if (lines.length > 0) {
      blocks.push(lines.join('\n'));
    }
  }

  return blocks.join('\n\n');
}
