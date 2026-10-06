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
      // 閾値は develop 全ファイル基準の実測から 1 ポイントの余白を引いた床。上げるときも floor(実測) - 1 を人が書く。
      // floor(実測) だと余白が実測の小数部そのままになり、
      // 例えば branches 13.09% で床 13 になると未カバー分岐 128 個で割る（＝通常の機能 PR 1 本で落ちる）。
      // autoUpdate は使わない。Vitest は実測が床を超えると書式関数に実測値だけを渡すため、
      // floor(実測) - 1 では床 22・実測 22.x のとき 21 に下がる（床を下げない書式関数は書けない）。
      // 閾値割れは ABORT して人に返す運用（.takt/facets/instructions/spec-to-pr/implement.md）なので、
      // 床は「新規コードがテスト無しで分母だけ増やす」事象だけを捉える幅を持たせる。
      // 数値合わせのテストは書かない（docs/specs/testing-strategy.md「閾値の合意記録」）。
      thresholds: {
        lines: 22,
        statements: 22,
        functions: 23,
        branches: 16,
      },
    },
  },
});
