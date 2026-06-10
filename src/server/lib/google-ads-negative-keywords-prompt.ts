import type { GoogleAdsNegativeKeyword } from '@/types/googleAds.types';

const NEGATIVE_KEYWORD_PROMPT_LIMIT = 2000;

type NegativeKeywordTheme = {
  keywordText: string;
  matchType: GoogleAdsNegativeKeyword['matchType'];
  level: GoogleAdsNegativeKeyword['level'];
};

type ScopedNegativeKeyword = {
  keywordText: string;
  matchType: GoogleAdsNegativeKeyword['matchType'];
  level: GoogleAdsNegativeKeyword['level'];
  campaignName: string;
  adGroupName: string;
};

type NegativeKeywordPromptLoad = {
  formatted: string;
  rawNegativeKw: number;
  uniqueNegativeKw: number;
  promptedNegativeKw: number;
  negativeKwChars: number;
};

type PrepareNegativeKeywordsOptions = {
  limit?: number;
  /**
   * theme: コンテンツ戦略提案向け。(テキスト, マッチタイプ, レベル) で畳み広告グループ名は捨てる。
   * scoped: 除外KW提案向け。ad_group はキャンペーン名・広告グループ名を保持する。
   */
  aggregation?: 'theme' | 'scoped';
};

/** CSV セル化: 区切り文字・引用符・改行を含む値のみ二重引用符で囲み内部引用符をエスケープ。 */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('ja-JP');
}

/**
 * 除外KWが「現在有効に除外しているか」。getNegativeKeywords は状態で絞らず全階層を返すため、
 * PAUSED/REMOVED キャンペーン（実際には除外していない）や停止中の広告グループの除外語を弾く。
 */
function isActiveNegativeKeyword(kw: GoogleAdsNegativeKeyword): boolean {
  if (kw.campaignStatus !== 'ENABLED') return false;
  if (kw.level === 'ad_group' && kw.adGroupStatus !== 'ENABLED') return false;
  return true;
}

function uniqueNegativeKeywordThemes(keywords: GoogleAdsNegativeKeyword[]): NegativeKeywordTheme[] {
  const seen = new Map<string, NegativeKeywordTheme>();
  for (const kw of keywords) {
    if (!isActiveNegativeKeyword(kw)) continue;
    const key = `${kw.keywordText.toLowerCase()}␟${kw.matchType}␟${kw.level}`;
    if (!seen.has(key)) {
      seen.set(key, { keywordText: kw.keywordText, matchType: kw.matchType, level: kw.level });
    }
  }
  return [...seen.values()];
}

/**
 * 除外KWをスコープ付きで集約する（除外KW提案向け）。
 * campaign は (テキスト, マッチタイプ) で畳み、ad_group は広告グループ単位を保持する。
 */
function uniqueScopedNegativeKeywords(keywords: GoogleAdsNegativeKeyword[]): ScopedNegativeKeyword[] {
  const seen = new Map<string, ScopedNegativeKeyword>();
  for (const kw of keywords) {
    if (!isActiveNegativeKeyword(kw)) continue;
    const scope =
      kw.level === 'ad_group' ? `${kw.campaignName}␟${kw.adGroupName ?? ''}` : '';
    const key = `${kw.level}␟${kw.keywordText.toLowerCase()}␟${kw.matchType}␟${scope}`;
    if (!seen.has(key)) {
      seen.set(key, {
        keywordText: kw.keywordText,
        matchType: kw.matchType,
        level: kw.level,
        campaignName: kw.campaignName,
        adGroupName: kw.level === 'ad_group' ? (kw.adGroupName ?? '') : '',
      });
    }
  }
  return [...seen.values()];
}

function sortThemes(themes: NegativeKeywordTheme[]): NegativeKeywordTheme[] {
  const levelRank: Record<GoogleAdsNegativeKeyword['level'], number> = {
    campaign: 0,
    ad_group: 1,
  };
  return [...themes].sort((a, b) => {
    const levelDiff = levelRank[a.level] - levelRank[b.level];
    if (levelDiff !== 0) return levelDiff;
    const textDiff = a.keywordText.localeCompare(b.keywordText, 'ja');
    return textDiff !== 0 ? textDiff : a.matchType.localeCompare(b.matchType);
  });
}

function sortScopedKeywords(keywords: ScopedNegativeKeyword[]): ScopedNegativeKeyword[] {
  const levelRank: Record<GoogleAdsNegativeKeyword['level'], number> = {
    campaign: 0,
    ad_group: 1,
  };
  return [...keywords].sort((a, b) => {
    const levelDiff = levelRank[a.level] - levelRank[b.level];
    if (levelDiff !== 0) return levelDiff;
    const campaignDiff = a.campaignName.localeCompare(b.campaignName, 'ja');
    if (campaignDiff !== 0) return campaignDiff;
    const adGroupDiff = a.adGroupName.localeCompare(b.adGroupName, 'ja');
    if (adGroupDiff !== 0) return adGroupDiff;
    const textDiff = a.keywordText.localeCompare(b.keywordText, 'ja');
    return textDiff !== 0 ? textDiff : a.matchType.localeCompare(b.matchType);
  });
}

function formatNegativeKeywordsFromThemes(themes: NegativeKeywordTheme[], limit: number): string {
  const header = '除外キーワード,マッチタイプ,適用範囲';

  if (themes.length === 0) {
    return `${header}\n（有効な除外キーワードなし）`;
  }

  const ordered = sortThemes(themes);
  const capped = ordered.slice(0, limit);
  const omitted = ordered.length - capped.length;

  const scopeLabel = (level: GoogleAdsNegativeKeyword['level']): string =>
    level === 'ad_group' ? '広告グループ' : 'キャンペーン';
  const rows = capped.map(
    t => `${csvCell(t.keywordText)},${csvCell(t.matchType)},${scopeLabel(t.level)}`
  );

  const lines = [header, ...rows];
  if (omitted > 0) {
    lines.push(
      `（ほか ${formatInteger(omitted)} 件は省略。campaign→ad_group 優先で有効な除外テーマ上位 ${formatInteger(limit)} 件を掲載）`
    );
  }
  return lines.join('\n');
}

function formatNegativeKeywordsFromScoped(keywords: ScopedNegativeKeyword[], limit: number): string {
  const header = '除外キーワード,マッチタイプ,適用範囲,キャンペーン名,広告グループ名';

  if (keywords.length === 0) {
    return `${header}\n（有効な除外キーワードなし）`;
  }

  const ordered = sortScopedKeywords(keywords);
  const capped = ordered.slice(0, limit);
  const omitted = ordered.length - capped.length;

  const scopeLabel = (level: GoogleAdsNegativeKeyword['level']): string =>
    level === 'ad_group' ? '広告グループ' : 'キャンペーン';
  const rows = capped.map(
    kw =>
      [
        csvCell(kw.keywordText),
        csvCell(kw.matchType),
        scopeLabel(kw.level),
        csvCell(kw.campaignName),
        csvCell(kw.adGroupName),
      ].join(',')
  );

  const lines = [header, ...rows];
  if (omitted > 0) {
    lines.push(
      `（ほか ${formatInteger(omitted)} 件は省略。campaign→ad_group 優先で有効な除外キーワード上位 ${formatInteger(limit)} 件を掲載）`
    );
  }
  return lines.join('\n');
}

function resolveOptions(options?: PrepareNegativeKeywordsOptions): {
  limit: number;
  aggregation: 'theme' | 'scoped';
} {
  return {
    limit: options?.limit ?? NEGATIVE_KEYWORD_PROMPT_LIMIT,
    aggregation: options?.aggregation ?? 'theme',
  };
}

/**
 * 除外KWをプロンプト用に整形する。
 */
export function formatNegativeKeywordsForPrompt(
  keywords: GoogleAdsNegativeKeyword[],
  options?: PrepareNegativeKeywordsOptions
): string {
  const { limit, aggregation } = resolveOptions(options);
  if (aggregation === 'scoped') {
    return formatNegativeKeywordsFromScoped(uniqueScopedNegativeKeywords(keywords), limit);
  }
  return formatNegativeKeywordsFromThemes(uniqueNegativeKeywordThemes(keywords), limit);
}

/** プロンプト投入用の整形と監視メトリクスを一括生成する。 */
export function prepareNegativeKeywordsForPrompt(
  keywords: GoogleAdsNegativeKeyword[],
  options?: PrepareNegativeKeywordsOptions
): NegativeKeywordPromptLoad {
  const { limit, aggregation } = resolveOptions(options);
  const uniqueNegativeKw =
    aggregation === 'scoped'
      ? uniqueScopedNegativeKeywords(keywords).length
      : uniqueNegativeKeywordThemes(keywords).length;
  const formatted = formatNegativeKeywordsForPrompt(keywords, { limit, aggregation });

  return {
    formatted,
    rawNegativeKw: keywords.length,
    uniqueNegativeKw,
    promptedNegativeKw: Math.min(uniqueNegativeKw, limit),
    negativeKwChars: formatted.length,
  };
}
