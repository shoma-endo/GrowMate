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
    // Next.js が内部で peer dependency として要求するパッケージ
    'react-dom',
    'react-is',
    '@types/react-dom',
    // CLI ツールとして package.json scripts 経由で利用
    'eslint',
    'husky',
    'supabase',
    'tsx',
  ],
  ignoreBinaries: [
    // CI・scripts で npx 経由または PATH 経由で実行するバイナリ
    'tsx',
    'next',
    'tsc',
    'eslint',
    'supabase',
    'knip',
    'husky',
  ],
};

export default config;
