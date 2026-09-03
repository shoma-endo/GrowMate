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
      // html はファイル別の未実行行を見るため（coverage/ は gitignore 済み）
      reporter: ['text-summary', 'json-summary', 'html'],
      // 閾値は develop 全ファイル基準の実測（2026-09-03: lines 15.46 / stmts 15.51 / funcs 16.73 / branches 11.52）の切り捨て。
      // 整数 1 ポイント上がるごとに autoUpdate が config を書き換える（ラチェット）。下げる変更は仕様合意が要る。
      // 数値合わせのテストは書かない（docs/specs/testing-strategy.md）。
      thresholds: {
        autoUpdate: (newThreshold) => Math.floor(newThreshold),
        lines: 15,
        statements: 15,
        functions: 16,
        branches: 11,
      },
    },
  },
});
