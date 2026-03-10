import nextConfig from 'eslint-config-next';

const config = [
  {
    ignores: ['.next', 'next-env.d.ts', 'scripts', 'types'],
  },
  ...nextConfig,
  // eslint-config-next 16 で追加された React Compiler 関連の厳格ルール
  // ESLint 9 フラットConfig 移行のため 15.x に戻せず、既存コードが対応するまで off にする
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'off',
    },
  },
];

export default config;
