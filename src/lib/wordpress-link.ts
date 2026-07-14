interface WordPressLinkState {
  canonical_url?: string | null;
  wp_post_id?: number | null;
}

export function isWordPressLinked(data?: WordPressLinkState | null): boolean {
  const hasPostId = typeof data?.wp_post_id === 'number' && data.wp_post_id > 0;
  const hasCanonicalUrl = Boolean(data?.canonical_url?.trim());
  return hasPostId || hasCanonicalUrl;
}
