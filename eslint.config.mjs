import nextConfig from 'eslint-config-next';

// 'use client' ファイルから src/server/{services,lib,middleware,auth} への直 import を禁止する。
// これらは Service Role キー等の秘密情報を扱う層のため、クライアントバンドルへの混入を機械的に防ぐ。
// @/server/actions（Server Actions）と @/server/schemas（型・バリデーション共有用）は対象外。
const noServerInternalImportInClient = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "'use client' ファイルから src/server/{services,lib,middleware,auth} の直 import を禁止する",
    },
    schema: [],
  },
  create(context) {
    let isClientFile = false;

    function checkSource(node, source) {
      if (!isClientFile || typeof source !== 'string') return;
      const match = /(?:^@\/server\/|\/server\/)(services|lib|middleware|auth)(\/|$)/.exec(source);
      if (match) {
        context.report({
          node,
          message: `'use client' ファイルから @/server/${match[1]} を直接 import できません。Server Action (@/server/actions) 経由にしてください。`,
        });
      }
    }

    return {
      Program(node) {
        const first = node.body[0];
        isClientFile =
          !!first &&
          first.type === 'ExpressionStatement' &&
          first.expression.type === 'Literal' &&
          first.expression.value === 'use client';
      },
      ImportDeclaration(node) {
        checkSource(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },
    };
  },
};

const config = [
  {
    ignores: ['.next', 'next-env.d.ts', 'scripts', 'types', 'coverage'],
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
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      local: {
        rules: {
          'no-server-internal-import-in-client': noServerInternalImportInClient,
        },
      },
    },
    rules: {
      'local/no-server-internal-import-in-client': 'error',
    },
  },
];

export default config;
