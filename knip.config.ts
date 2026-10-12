import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // takt は ignoreBinaries から外した。workflow contract テストが doctor を呼ぶ経路は
  // pin 版の絶対パス（resolveTaktBin）になり、knip から見て裸のバイナリ参照が消えたため。
  ignore: [
    'src/types/database.types.ts', // Supabase 自動生成ファイル
  ],
};

export default config;
