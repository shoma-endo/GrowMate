import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: [
    'src/types/database.types.ts', // Supabase 自動生成ファイル
  ],
};

export default config;
