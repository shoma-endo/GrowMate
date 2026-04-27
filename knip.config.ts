import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: [
    'src/types/database.types.ts', // Supabase 自動生成ファイル
  ],
  ignoreDependencies: [
    // eslint-config-next が内部で require する ESLint プラグイン群
    // 直接 import はしないが削除すると lint が壊れる
    '@eslint/js',
    '@typescript-eslint/eslint-plugin',
    '@typescript-eslint/parser',
    'eslint-plugin-import',
    'eslint-plugin-jsx-a11y',
    'eslint-plugin-react',
    'eslint-plugin-react-hooks',
    // supabase:types スクリプトで CLI バイナリとして使用
    'supabase',
  ],
};

export default config;
