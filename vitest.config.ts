import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      // テストが import したファイルだけでなく src/app 全体を分母にする（未テストのファイルを見えなくしない）
      include: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
      exclude: ['src/types/**', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      // 閾値は全ファイル基準の実測（2026-09-03: lines 16.29 / stmts 16.37 / funcs 17.70 / branches 12.14）の切り捨て。
      // 整数 1 ポイント上がるごとに autoUpdate が config を書き換える（ラチェット）。下げる変更は仕様合意が要る。
      // 数値合わせのテストは書かない（docs/specs/testing-strategy.md）。
      thresholds: {
        autoUpdate: (newThreshold) => Math.floor(newThreshold),
        lines: 16,
        statements: 16,
        functions: 17,
        branches: 12,
      },
    },
  },
});
