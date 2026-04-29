const FULL_MARKDOWN_PREFIX = '"full_markdown":"';

interface FullMarkdownDecoder {
  feed: (chunk: string) => string;
  reset: () => void;
}

export const createFullMarkdownDecoder = (): FullMarkdownDecoder => {
  const prefix = FULL_MARKDOWN_PREFIX;
  let prefixIndex = 0;
  let capturing = false;
  let escapeNext = false;
  let unicodeRemaining = 0;
  let unicodeBuffer = '';
  let result = '';

  const feed = (chunk: string) => {
    for (let i = 0; i < chunk.length; i += 1) {
      const char = chunk[i]!;

      if (!capturing) {
        if (char === prefix[prefixIndex]!) {
          prefixIndex += 1;
          if (prefixIndex === prefix.length) {
            capturing = true;
            prefixIndex = 0;
          }
        } else {
          prefixIndex = char === prefix[0] ? 1 : 0;
        }
        continue;
      }

      if (unicodeRemaining > 0) {
        if (/[0-9a-fA-F]/.test(char)) {
          unicodeBuffer += char;
          unicodeRemaining -= 1;
          if (unicodeRemaining === 0) {
            const codePoint = Number.parseInt(unicodeBuffer, 16);
            if (!Number.isNaN(codePoint)) {
              result += String.fromCodePoint(codePoint);
            }
            unicodeBuffer = '';
          }
        } else {
          unicodeRemaining = 0;
          unicodeBuffer = '';
          if (char === '"') {
            capturing = false;
          }
        }
        continue;
      }

      if (escapeNext) {
        switch (char) {
          case '\\':
            result += '\\';
            break;
          case '"':
            result += '"';
            break;
          case '/':
            result += '/';
            break;
          case 'b':
            result += '\b';
            break;
          case 'f':
            result += '\f';
            break;
          case 'n':
            result += '\n';
            break;
          case 'r':
            result += '\r';
            break;
          case 't':
            result += '\t';
            break;
          case 'u':
            unicodeRemaining = 4;
            unicodeBuffer = '';
            break;
          default:
            result += char;
            break;
        }
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        capturing = false;
        continue;
      }

      result += char;
    }

    return result;
  };

  const reset = () => {
    prefixIndex = 0;
    capturing = false;
    escapeNext = false;
    unicodeRemaining = 0;
    unicodeBuffer = '';
    result = '';
  };

  return { feed, reset };
};
