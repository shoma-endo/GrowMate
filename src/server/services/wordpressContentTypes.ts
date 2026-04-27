type WordPressContentType = string;

export const BLOCKED_WORDPRESS_CONTENT_TYPES = new Set([
  'attachment',
  'media',
  'feedback',
  'wp_block',
  'wp-template',
  'wp_template',
  'wp_template_part',
  'wp-template-part',
  'wp_global_styles',
  'wp-global-styles',
  'wp_navigation',
  'wp-navigation',
  'wp_font_family',
  'wp-font-family',
  'wp_font_face',
  'wp-font-face',
  'wp_pattern',
  'wp-pattern',
  'nav_menu_item',
  'menu-item',
  'menu-items',
  'jp_pay_order',
  'jp-pay-order',
  'jp_pay_product',
  'jp-pay-product',
]);

export function normalizeContentType(input: string): WordPressContentType {
  const trimmed = input.replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!trimmed) {
    return 'posts';
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === 'post') return 'posts';
  if (lowered === 'page') return 'pages';
  return trimmed;
}

export function normalizeContentTypes(inputs?: string[] | null): WordPressContentType[] {
  if (!Array.isArray(inputs)) {
    return [];
  }

  const trimmed = inputs
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(value => value.length > 0);

  if (trimmed.length === 0) {
    return [];
  }

  const normalized = trimmed
    .map(value => normalizeContentType(value))
    .filter(value => {
      const lower = value.toLowerCase();
      if (BLOCKED_WORDPRESS_CONTENT_TYPES.has(lower)) {
        return false;
      }
      if (lower.startsWith('wp_') || lower.startsWith('wp-')) {
        return false;
      }
      if (lower.startsWith('jp_') || lower.startsWith('jp-')) {
        return false;
      }
      return true;
    });

  return Array.from(new Set(normalized));
}
