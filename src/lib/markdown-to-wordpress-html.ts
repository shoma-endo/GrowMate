import { Marked, type Tokens } from 'marked';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function safeHref(href: string | undefined): string | null {
  if (href === undefined) return null;
  const normalizedHref = href.trim();
  const scheme = normalizedHref.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();

  if (scheme) {
    return ['http', 'https', 'mailto'].includes(scheme) ? normalizedHref : null;
  }

  if (normalizedHref.startsWith('//') || normalizedHref.startsWith('\\\\')) {
    return null;
  }

  return normalizedHref;
}

const marked = new Marked({
  async: false,
  gfm: true,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link) {
      const safeLink = safeHref(href);
      const text = this.parser.parseInline(tokens);

      if (safeLink === null) {
        return text;
      }

      const titleAttribute = title == null ? '' : ` title="${escapeHtml(title)}"`;
      return `<a href="${escapeHtml(safeLink)}"${titleAttribute}>${text}</a>`;
    },
  },
});

export function markdownToWordPressHtml(markdown: string): string {
  return marked.parse(markdown, { async: false });
}
