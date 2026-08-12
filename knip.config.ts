import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: [
    'src/types/database.types.ts', // Supabase 自動生成ファイル
    'scripts/lark-notify.cjs', // GitHub Actions ワークフローYAML内のheredocからrequireされるため静的解析が届かない
  ],
};

export default config;
