export class ChatProcessorService {
  extractKeywordSections(text: string): { immediate: string[]; later: string[] } {
    const extractSection = (source: string | undefined): string[] =>
      source
        ?.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0) ?? [];

    const matchBetween = text.match(/【今すぐ客キーワード】([\s\S]*?)【後から客キーワード】/);
    const matchImmediateOnly = text.match(/【今すぐ客キーワード】([\s\S]*)/);
    const matchLater = text.match(/【後から客キーワード】([\s\S]*)$/);

    let immediate: string[] = [];
    let later: string[] = [];

    if (matchBetween) {
      immediate = extractSection(matchBetween[1]);
      later = extractSection(matchLater?.[1]);
    } else if (matchImmediateOnly) {
      immediate = extractSection(matchImmediateOnly[1]);
    } else if (matchLater) {
      later = extractSection(matchLater[1]);
    } else {
      immediate = extractSection(text);
    }

    return { immediate, later };
  }
}
