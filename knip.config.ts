import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: [
    'src/types/database.types.ts', // Supabase 自動生成ファイル
    'scripts/lark-notify.cjs', // GitHub Actions ワークフローYAML内のheredocからrequireされるため静的解析が届かない
    'scripts/takt/takt-safe.mjs', // グローバルTAKTのCLI起動前にreport contextを除去するランチャー
    'scripts/takt/prompt-sanitizer.mjs', // TAKTランチャーから動的に利用されるプロンプトサニタイザー
  ],
};

export default config;
