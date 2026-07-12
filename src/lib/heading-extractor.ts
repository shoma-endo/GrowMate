/**
 * Extract H2, H3, and H4 headings from markdown text.
 */

const HEADING_WHITESPACE =
  new Set<string>([' ', '\t', '\u3000']);

const WRAPPED_HEADING_MIN_LENGTH = 20;
const WRAPPED_HEADING_CONTINUATION_MAX_LENGTH = 20;

/**
 * h2/h3/h4 見出し行を解析する（正規表現を使用しない）。
 * 例: "h2 見出し" / "h3　見出し" / "h3見出し" / "H4見出し" / "h2: 見出し" / "h2： 見出し"
 * レベル数字の直後にコロン（半角 `:` / 全角 `：`）・スペースの有無は不問。
 * 連続コロン（"h2:: …"）もまとめてスキップする。
 */
function parseH2H3H4HeadingLine(line: string): { text: string; level: 2 | 3 | 4 } | null {
  const t = line.trim();
  if (t.length < 3) return null;

  const c0 = t.charAt(0).toLowerCase();
  const c1 = t.charAt(1);
  if (c0 !== 'h' || (c1 !== '2' && c1 !== '3' && c1 !== '4')) return null;

  const level = c1 === '2' ? 2 : c1 === '3' ? 3 : 4;
  let i = 2;
  if (i >= t.length) return null;
  while (i < t.length && (t.charAt(i) === ':' || t.charAt(i) === '：')) i++;
  while (i < t.length && HEADING_WHITESPACE.has(t.charAt(i))) i++;
  const text = t.slice(i).trim();
  if (!text) return null;
  return { text, level };
}

/**
 * markdown 形式の h2/h3/h4 見出し行を解析する（正規表現を使用しない）。
 * 例: "## 見出し" / "### 見出し" / "#### 見出し" / "### 見出し ###"
 * '#' の直後には 1 文字以上の空白が必要（"#text" は見出しと見なさない）。
 * CommonMark 準拠で終端 ATX マーカー（"### foo ###"）も剥がす。
 */
function parseMarkdownH2H3H4HeadingLine(line: string): { text: string; level: 2 | 3 | 4 } | null {
  const t = line.trim();
  if (t.length < 2 || t.charAt(0) !== '#') return null;

  let level = 0;
  while (level < t.length && t.charAt(level) === '#') level++;
  if (level !== 2 && level !== 3 && level !== 4) return null;
  if (level >= t.length || !HEADING_WHITESPACE.has(t.charAt(level))) return null;

  let i = level + 1;
  while (i < t.length && HEADING_WHITESPACE.has(t.charAt(i))) i++;
  let text = t.slice(i).trim();
  if (!text) return null;

  // 終端 ATX マーカーを除去する。終端 '#' 列は本文と空白で区切られている必要がある
  // （"foo#" は本文の一部として残す。CommonMark 準拠）。
  let j = text.length - 1;
  while (j >= 0 && text.charAt(j) === '#') j--;
  const hashStart = j + 1;
  if (hashStart < text.length && j >= 0 && HEADING_WHITESPACE.has(text.charAt(j))) {
    text = text.slice(0, j).trimEnd();
  }

  if (!text) return null;
  return { text, level };
}

/**
 * 見出し行から見出しテキストを抽出する。
 * 独自形式 ("h2 見出し") と markdown 形式 ("## 見出し") の両方に対応。
 */
export function extractHeadingTextFromLine(line: string): string | null {
  return parseH2H3H4HeadingLine(line)?.text ?? parseMarkdownH2H3H4HeadingLine(line)?.text ?? null;
}

interface ExtractedHeading {
  text: string;
  level: 2 | 3 | 4;
  orderIndex: number;
}

/**
 * リッチテキスト経由の保存で長い見出しの末尾だけが次行へ折り返された場合に連結する。
 * 通常本文の誤結合を避けるため、長い見出し・インデントされた短い次行・直後の空行を必須とする。
 */
function appendWrappedHeadingContinuation(
  lines: string[],
  lineIndex: number,
  headingText: string
): string {
  if (headingText.length < WRAPPED_HEADING_MIN_LENGTH) return headingText;

  const nextLine = lines[lineIndex + 1];
  if (nextLine === undefined || nextLine === nextLine.trim()) return headingText;

  const continuation = nextLine.trim();
  if (
    !continuation ||
    continuation.length > WRAPPED_HEADING_CONTINUATION_MAX_LENGTH ||
    continuation === '---' ||
    parseH2H3H4HeadingLine(continuation)
  ) {
    return headingText;
  }

  const followingLine = lines[lineIndex + 2];
  if (followingLine !== undefined && followingLine.trim() !== '') return headingText;

  return `${headingText}${continuation}`;
}

/**
 * Step 5の構成案テキストから、h2/h3/h4の見出しを抽出する。
 * その他のレベルの見出しは無視する。
 * Step5/basic_structure は独自プレフィックス形式（`h2 …` / `H3 …` / `H4 …`）のみを正とする
 * （仕様 docs/specs/step7-heading-flow-spec.md §4）。markdown 形式（`## …` / `### …` / `#### …`）は対象外。
 */
export function extractHeadingsFromMarkdown(markdown: string): ExtractedHeading[] {
  if (!markdown) return [];

  const lines = markdown.split('\n');
  const headings: ExtractedHeading[] = [];
  let orderIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const trimmed = line.trim();
    const parsed = parseH2H3H4HeadingLine(trimmed);
    if (parsed) {
      headings.push({
        text: appendWrappedHeadingContinuation(lines, lineIndex, parsed.text),
        level: parsed.level,
        orderIndex: orderIndex++,
      });
    }
  }

  return headings;
}

/**
 * 見出しの識別子（heading_key）を生成する。
 * 形式: {order_index}:{normalized_heading_text}:{short_hash}
 *
 * 設計上の注意: 見出しテキストが変わるとキーが変わり、既存DBレコードとの紐付けが切れる。
 * (session_id, heading_key) の UNIQUE 制約により、step5 を微修正した場合は新規セクション扱いになる。
 * 将来的にテキスト微修正（誤字等）への耐性が必要な場合は、orderIndex のみをキーにする方式の検討を推奨。
 */
export function generateHeadingKey(orderIndex: number, headingText: string): string {
  const normalizedText = headingText
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const hash = sha256Hash(headingText);
  return `${orderIndex}:${normalizedText}:${hash}`;
}

/** 句読点・記号（文末でよく付くもの） */
const TRAILING_PUNCTUATION = /[。、．，・!?！？\s]*$/;

/**
 * 見出し比較用の正規化（余分な空白・全角半角揺れ・句読点に耐性を持たせる）
 */
function normalizeHeadingForComparison(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(TRAILING_PUNCTUATION, '').normalize('NFKC');
}

/**
 * 正規化後の見出し同士が「実質一致」とみなせるか。
 * 完全一致、LLM の句読点追加（line が expected + 句読点で始まる）のみ許容する。
 * expected が line の prefix となる短い前方一致は許容しない（例: 「導入」と「導入手順」の誤除去を防ぐ）。
 */
function headingsMatchAfterNormalization(lineNorm: string, expectedNorm: string): boolean {
  if (lineNorm === expectedNorm) return true;
  if (lineNorm.startsWith(expectedNorm)) {
    const suffix = lineNorm.slice(expectedNorm.length).trim();
    return suffix.length === 0 || /^[。、．，・!?！？：:-]+$/.test(suffix);
  }
  return false;
}

/**
 * 結合時の自己修復用: content の冒頭 lookahead 行内に headingText と実質一致する
 * 見出し行（markdown ATX または 独自 h2/h3/h4 形式）があれば、その行までを丸ごと削除した
 * content を返す。前置き（"本文を以下に示します。"等）も併せて除去される。
 *
 * 一致しない場合は元の content をそのまま返す。
 *
 * 設計意図: 「本文側に紛れ込んだ見出し」は保存ミスとして除去対象とし、結合時には常に
 * canonical な ${'#'.repeat(heading_level)} ${heading_text} を prepend する側で見出しを
 * 出力する（呼び出し側の責務）。レベル不一致 (`#### 見出し` 等) も text 一致なら除去対象。
 *
 * fenced/indented code block 内のコード例として書かれた見出しは除外する（CommonMark 準拠）。
 */
function stripLeadingMatchingHeadingFromBody(
  content: string,
  headingText: string,
  lookahead = 5
): string {
  if (!content || !headingText) return content;
  const expectedNorm = normalizeHeadingForComparison(headingText);
  const lines = content.split('\n');
  const limit = Math.min(lines.length, lookahead);

  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let lastMatchingHeadingIndex = -1;
  for (let i = 0; i < limit; i++) {
    const rawLine = lines[i]!;

    if (inFence) {
      const closeRe = fenceChar === '`' ? /^ {0,3}(`{3,})\s*$/ : /^ {0,3}(~{3,})\s*$/;
      const closeMatch = closeRe.exec(rawLine);
      if (closeMatch && closeMatch[1]!.length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
      continue;
    }

    const openMatch = /^ {0,3}(`{3,}|~{3,})/.exec(rawLine);
    if (openMatch) {
      inFence = true;
      fenceChar = openMatch[1]![0]!;
      fenceLen = openMatch[1]!.length;
      continue;
    }

    // indented code block（半角 4 個 or 0-3 + タブ）も同様に除外する。
    if (/^( {0,3}\t| {4})/.test(rawLine)) continue;

    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const lineHeadingText = extractHeadingTextFromLine(trimmed);
    if (lineHeadingText === null) continue;

    const lineNorm = normalizeHeadingForComparison(lineHeadingText);
    if (!headingsMatchAfterNormalization(lineNorm, expectedNorm)) continue;

    // Canvas 側の canonical 見出しと LLM 応答内の見出しが重なる場合があるため、
    // 最初の一致で返さず、冒頭 lookahead 内の最後の一致までを除去対象にする。
    lastMatchingHeadingIndex = i;
  }

  if (lastMatchingHeadingIndex >= 0) {
    let j = lastMatchingHeadingIndex + 1;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    return lines.slice(j).join('\n');
  }

  return content;
}

/**
 * Step7 の見出し単位本文を、仕様上の「対象見出しから次の対象見出し直前まで」に正規化する。
 *
 * LLM が H2 の配下にある H3/H4 まで先取りして出力した場合、そのまま保存すると後続の
 * 見出し単位生成と重複する。このため対象見出し行を除去した後、コードブロック外で最初に
 * 現れる別の H2/H3/H4 以降を保存対象から除外する。
 */
export function normalizeHeadingUnitContent(
  content: string,
  headingText: string,
  subsequentHeadingTexts: string[] = []
): string {
  if (!content) return content;

  const body = stripLeadingMatchingHeadingFromBody(content, headingText);
  const lines = body.split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;

    if (inFence) {
      const closeRe = fenceChar === '`' ? /^ {0,3}(`{3,})\s*$/ : /^ {0,3}(~{3,})\s*$/;
      const closeMatch = closeRe.exec(rawLine);
      if (closeMatch && closeMatch[1]!.length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
      continue;
    }

    const openMatch = /^ {0,3}(`{3,}|~{3,})/.exec(rawLine);
    if (openMatch) {
      inFence = true;
      fenceChar = openMatch[1]![0]!;
      fenceLen = openMatch[1]!.length;
      continue;
    }

    if (/^( {0,3}\t| {4})/.test(rawLine)) continue;

    const trimmed = rawLine.trim();
    const extractedHeadingText = extractHeadingTextFromLine(trimmed);
    if (extractedHeadingText === null) continue;

    // `H2直下では…` / `H2 直下では…` / `H2: では…` のような通常本文を
    // 見出しと誤認して欠落させないよう、表記にかかわらず後続の正本見出しとの一致を必須にする。
    // Markdown 見出しは新規生成しないが、過去データの互換処理として同じ一致条件で扱う。
    const matchesSubsequentHeading = subsequentHeadingTexts.some(
      text => normalizeHeadingForComparison(text) === normalizeHeadingForComparison(extractedHeadingText)
    );
    if (!matchesSubsequentHeading) continue;

    return lines.slice(0, i).join('\n').trimEnd();
  }

  return body.trimEnd();
}

/**
 * SHA-256 を使用して見出しの短いハッシュを生成し、上位8文字（16進数）を返す。
 * ブラウザ/サーバー両方で動くよう、Node crypto への依存を排除した純粋な JavaScript 実装。
 */
function sha256Hash(str: string): string {
  // SHA-256 synchronous implementation for cross-platform support
  // This is a minimal implementation to avoid bundling Node's 'crypto'
  function rotr(n: number, b: number) {
    return (n >>> b) | (n << (32 - b));
  }
  function sha256(str: string) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
      0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
      0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
      0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
      0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
      0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
      0xc67178f2,
    ];
    const H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
      0x5be0cd19,
    ];

    // Encode string as UTF-8 bytes to handle non-ASCII characters correctly
    const utf8Data = new TextEncoder().encode(str);
    const dataLen = utf8Data.length;

    // Overlap initialization with a larger size to be safe
    const totalWords = (((dataLen + 8) >> 6) + 1) * 16;
    const wordsBuffer = new Array(totalWords).fill(0);

    for (let i = 0; i < dataLen; i++) {
      wordsBuffer[i >> 2] |= (utf8Data[i]! & 0xff) << (24 - (i % 4) * 8);
    }

    const bitLen = dataLen * 8;
    wordsBuffer[bitLen >> 5] |= 0x80 << (24 - (bitLen % 32));
    wordsBuffer[(((bitLen + 64) >> 9) << 4) + 15] = bitLen;

    for (let i = 0; i < wordsBuffer.length; i += 16) {
      const w = wordsBuffer.slice(i, i + 16);
      if (w.length < 16) break;
      let a = H[0]!,
        b = H[1]!,
        c = H[2]!,
        d = H[3]!,
        e = H[4]!,
        f = H[5]!,
        g = H[6]!,
        h = H[7]!;

      for (let j = 0; j < 64; j++) {
        if (j >= 16) {
          const w15 = w[j - 15]!,
            w2 = w[j - 2]!,
            w16 = w[j - 16]!,
            w7 = w[j - 7]!;
          const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
          const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
          w[j] = (w16 + s0 + w7 + s1) | 0;
        }
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + s1 + ch + K[j]! + w[j]!) | 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + maj) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      H[0] = (H[0]! + a) | 0;
      H[1] = (H[1]! + b) | 0;
      H[2] = (H[2]! + c) | 0;
      H[3] = (H[3]! + d) | 0;
      H[4] = (H[4]! + e) | 0;
      H[5] = (H[5]! + f) | 0;
      H[6] = (H[6]! + g) | 0;
      H[7] = (H[7]! + h) | 0;
    }

    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  return sha256(str).slice(0, 8);
}
