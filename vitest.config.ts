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
      // 閾値は develop 全ファイル基準の実測から 1 ポイントの余白を引いた床。
      // ラチェットは floor(実測) - 1。floor(実測) だと余白が実測の小数部そのままになり、
      // 例えば branches 13.09% で床 13 になると未カバー分岐 128 個で割る（＝通常の機能 PR 1 本で落ちる）。
      // 閾値割れは ABORT して人に返す運用（.takt/facets/instructions/spec-to-pr/implement.md）なので、
      // 床は「新規コードがテスト無しで分母だけ増やす」事象だけを捉える幅を持たせる。
      // 数値合わせのテストは書かない（docs/specs/testing-strategy.md「閾値の合意記録」）。
      thresholds: {
        autoUpdate: (newThreshold) => Math.max(0, Math.floor(newThreshold) - 1),
        lines: 16,
        statements: 16,
        functions: 17,
        branches: 12,
      },
    },
  },
});
