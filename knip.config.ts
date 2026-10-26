import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // takt は ignoreBinaries から外した。workflow contract テストが doctor を呼ぶ経路は
  // pin 版の絶対パス（resolveTaktBin）になり、knip から見て裸のバイナリ参照が消えたため。
  ignore: [
    'src/types/database.types.ts', // Supabase 自動生成ファイル
    '.design-sync/**', // Claude Design への同期（design-sync）の入力。アプリからは import しない
  ],
  ignoreDependencies: [
    'supabase', // scripts/gen-supabase-types.sh から呼ぶ。knip はシェルスクリプト内のバイナリ参照を追えない
  ],
};

export default config;
