const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)\s*```/i;

function findFirstJsonObject(response: string): string | null {
  const start = response.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < response.length; index += 1) {
    const character = response[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return response.slice(start, index + 1);
    }
  }
  return null;
}

/** AI の応答から JSON オブジェクトの文字列を取り出す。```json ブロックを優先し、無ければ本文中の最初の {...} */
export function extractJsonObjectText(response: string): string | null {
  return response.match(JSON_BLOCK_REGEX)?.[1]?.trim() || findFirstJsonObject(response);
}
