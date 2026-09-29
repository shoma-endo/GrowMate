import { describe, expect, it } from 'vitest';
import {
  chunkIds,
  ID_QUERY_CHUNK_SIZE,
  normalizeBulkTargetIds,
  planBulkEvaluationInserts,
} from '@/server/lib/gsc-bulk-evaluation';

const ids = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `id-${index + 1}`);

describe('gsc-bulk-evaluation', () => {
  describe('normalizeBulkTargetIds', () => {
    it('空白と重複を除去し、最初の出現順を保つ', () => {
      expect(normalizeBulkTargetIds([' a ', '', 'b', 'a', '  ', ' b '])).toEqual(['a', 'b']);
      expect(normalizeBulkTargetIds(['', '  ', '\t'])).toEqual([]);
    });
  });

  describe('chunkIds', () => {
    it.each([
      [0, 0, []],
      [1, 1, [1]],
      [100, 1, [100]],
      [101, 2, [100, 1]],
      [1000, 10, [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]],
    ])('%i件を100件単位で分割する', (count, expectedChunkCount, expectedLengths) => {
      const chunks = chunkIds(ids(count), ID_QUERY_CHUNK_SIZE);
      expect(chunks).toHaveLength(expectedChunkCount);
      expect(chunks.map(chunk => chunk.length)).toEqual(expectedLengths);
    });
  });

  describe('planBulkEvaluationInserts', () => {
    it.each([
      ['既登録なし', [], ['a', 'b', 'c'], 0],
      ['一部既登録', ['b'], ['a', 'c'], 1],
      ['全件既登録', ['a', 'b', 'c'], [], 3],
    ])('既登録分を差し引く（%s）', (_label, existing, toInsertIds, skippedAlreadyRegisteredCount) => {
      expect(
        planBulkEvaluationInserts({
          candidateIds: ['a', 'b', 'c'],
          existingIds: new Set(existing),
        })
      ).toEqual({ toInsertIds, skippedAlreadyRegisteredCount });
    });
  });
});
