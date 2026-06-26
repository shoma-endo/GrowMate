import 'server-only';

import { google, type docs_v1 } from 'googleapis';
import { getGoogleDocsCredentials } from '@/server/lib/googleDocsCredentials';

const DOC_ID_PATTERN = /\/document\/d\/([a-zA-Z0-9-_]+)/;

export function parseGoogleDocId(sourceUrl: string): string | null {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return null;

  const match = trimmed.match(DOC_ID_PATTERN);
  if (match?.[1]) return match[1];

  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export async function fetchGoogleDocPlainText(documentId: string): Promise<string> {
  const credentials = getGoogleDocsCredentials();
  const auth = new google.auth.JWT({
    email: credentials.clientEmail,
    key: credentials.privateKey,
    scopes: ['https://www.googleapis.com/auth/documents.readonly'],
  });

  const docs = google.docs({ version: 'v1', auth });
  const response = await docs.documents.get({
    documentId,
    includeTabsContent: true,
  });

  const document = response.data;
  const tabSections: string[] = [];

  if (Array.isArray(document.tabs) && document.tabs.length > 0) {
    for (const tab of document.tabs) {
      const tabTitle = tab.tabProperties?.title?.trim();
      const tabBody = tab.documentTab?.body;
      const tabText = tabBody ? extractBodyText(tabBody) : '';
      if (!tabText.trim()) continue;

      tabSections.push(tabTitle ? `## ${tabTitle}\n\n${tabText.trim()}` : tabText.trim());
    }
  } else if (document.body) {
    const bodyText = extractBodyText(document.body);
    if (bodyText.trim()) {
      tabSections.push(bodyText.trim());
    }
  }

  return tabSections.join('\n\n---\n\n').trim();
}

function extractBodyText(body: docs_v1.Schema$Body): string {
  const lines: string[] = [];

  for (const element of body.content ?? []) {
    const line = extractStructuralElementText(element);
    if (line) {
      lines.push(line);
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractStructuralElementText(element: docs_v1.Schema$StructuralElement): string {
  if (element.paragraph) {
    return extractParagraphText(element.paragraph);
  }

  if (element.table) {
    return extractTableText(element.table);
  }

  return '';
}

function extractParagraphText(paragraph: docs_v1.Schema$Paragraph): string {
  const parts: string[] = [];

  for (const element of paragraph.elements ?? []) {
    const text = extractParagraphElementText(element);
    if (text) parts.push(text);
  }

  const content = parts.join('').trimEnd();
  if (!content) return '';

  const bullet = paragraph.bullet;
  if (bullet) {
    const nestingLevel = bullet.nestingLevel ?? 0;
    const prefix = `${'  '.repeat(nestingLevel)}- `;
    return `${prefix}${content}`;
  }

  return content;
}

function extractParagraphElementText(element: docs_v1.Schema$ParagraphElement): string {
  if (element.textRun?.content) {
    const text = element.textRun.content;
    const url = element.textRun.textStyle?.link?.url;
    if (url && text.trim()) {
      return `${text.trim()} (${url})`;
    }
    return text;
  }

  if (element.inlineObjectElement) {
    return '';
  }

  if (element.footnoteReference) {
    return '';
  }

  return '';
}

function extractTableText(table: docs_v1.Schema$Table): string {
  const rows: string[] = [];

  for (const row of table.tableRows ?? []) {
    const cells: string[] = [];

    for (const cell of row.tableCells ?? []) {
      const cellLines: string[] = [];
      for (const content of cell.content ?? []) {
        const text = extractStructuralElementText(content);
        if (text) cellLines.push(text);
      }
      cells.push(cellLines.join(' ').trim());
    }

    const rowText = cells.filter(Boolean).join(' | ').trim();
    if (rowText) rows.push(rowText);
  }

  return rows.join('\n');
}
