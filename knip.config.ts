import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: [
    'src/types/database.types.ts', // Supabase 自動生成ファイル
    'src/server/actions/adminKnowledgeSources.actions.ts', // Google Docs 本番UI復帰時に再接続する Server Actions
  ],
};

export default config;
