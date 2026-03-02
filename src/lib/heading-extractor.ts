/**
 * Extract H3 and H4 headings from markdown text.
 */

/** 任意レベルの markdown 見出し行にマッチ（例: `### 見出し` → capture group 1 が見出しテキスト） */
export const MARKDOWN_HEADING_REGEX = /^#+\s+(.+)$/;

export interface ExtractedHeading {
  text: string;
  level: 3 | 4;
  orderIndex: number;
}

/**
 * Step 5の構成案テキストから、H3およびH4の見出しを抽出する。
 * コードブロック内や、その他のレベルの見出しは無視する。
 */
export function extractHeadingsFromMarkdown(markdown: string): ExtractedHeading[] {
  if (!markdown) return [];

  const lines = markdown.split('\n');
  const headings: ExtractedHeading[] = [];
  let inCodeBlock = false;
  let orderIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // コードブロックの開始/終了を検知
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // H3 (###) または H4 (####) の見出しにマッチ
    // 正規表現: 行頭から # が 3〜4 つ続き、その後に空白、そして見出しテキスト
    const match = trimmed.match(/^(#{3,4})\s+(.+)$/);
    if (match) {
      const hashes = match[1] || '';
      const text = (match[2] || '').trim();

      // 空の見出しは除外
      if (text) {
        const level = hashes.length as 3 | 4;
        headings.push({
          text,
          level,
          orderIndex: orderIndex++,
        });
      }
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
const TRAILING_PUNCTUATION = /[。、．，．・!?！？\s]*$/;

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
    return suffix.length === 0 || /^[。、．，．・!?！？：:-]+$/.test(suffix);
  }
  return false;
}

/**
 * Step6保存時用: 先頭の見出し行を除去する。
 * combineSections が heading_text を自動付与するため、content には本文のみを保存する。
 * 先頭行が markdown 見出し (# で始まる) かつ headingText と実質一致する場合に除去。
 * LLM の句読点追加・語尾変更・軽微な言い換えにも耐性を持つ。
 */
export function stripLeadingHeadingLine(content: string, headingText: string): string {
  const trimmed = content.trim();
  if (!trimmed || !headingText) return content;

  const firstLine = trimmed.split('\n')[0]?.trim() ?? '';
  const match = firstLine.match(MARKDOWN_HEADING_REGEX);
  if (!match) return content;

  const lineHeadingText = (match[1] ?? '').trim();
  const a = normalizeHeadingForComparison(lineHeadingText);
  const b = normalizeHeadingForComparison(headingText);
  if (!headingsMatchAfterNormalization(a, b)) return content;

  // 見出し直後の改行のみ除去。本文先頭のインデント（コードブロック・ネスト箇条書き等）は保持する
  const rest = trimmed.slice(firstLine.length).replace(/^[\r\n]+/, '');
  return rest;
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
