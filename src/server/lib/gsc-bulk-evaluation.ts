export const MAX_BULK_EVALUATION_TARGETS = 1000;
export const ID_QUERY_CHUNK_SIZE = 100;

export function normalizeBulkTargetIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map(id => id.trim()).filter(id => id.length > 0)));
}

export function chunkIds(ids: string[], size: number): string[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Chunk size must be a positive integer');
  }

  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

export function planBulkEvaluationInserts(params: {
  candidateIds: string[];
  existingIds: Set<string>;
}): { toInsertIds: string[]; skippedAlreadyRegisteredCount: number } {
  const toInsertIds = params.candidateIds.filter(id => !params.existingIds.has(id));
  return {
    toInsertIds,
    skippedAlreadyRegisteredCount: params.candidateIds.length - toInsertIds.length,
  };
}
