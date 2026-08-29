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
    });

    it('すべて空白なら空配列を返す', () => {
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
    it('既登録がなければ全件を投入対象にする', () => {
      expect(
        planBulkEvaluationInserts({ candidateIds: ['a', 'b'], existingIds: new Set() })
      ).toEqual({ toInsertIds: ['a', 'b'], skippedAlreadyRegisteredCount: 0 });
    });

    it('全件既登録なら全件をスキップする', () => {
      expect(
        planBulkEvaluationInserts({
          candidateIds: ['a', 'b'],
          existingIds: new Set(['a', 'b']),
        })
      ).toEqual({ toInsertIds: [], skippedAlreadyRegisteredCount: 2 });
    });

    it('既登録分を差し引く', () => {
      expect(
        planBulkEvaluationInserts({
          candidateIds: ['a', 'b', 'c'],
          existingIds: new Set(['b']),
        })
      ).toEqual({ toInsertIds: ['a', 'c'], skippedAlreadyRegisteredCount: 1 });
    });
  });
});
