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

// テストケース（it / test）の本体に expect / assert 呼び出しが 1 つも無いものを禁止する。
// カバレッジ閾値を「コードを実行するだけのテスト」で埋める経路を機械的に塞ぐ
// （docs/specs/testing-strategy.md「閾値の合意記録」）。アサーションの強さまでは見ない。
const testHasAssertion = {
  meta: {
    type: 'problem',
    docs: { description: 'it / test の本体に expect / assert 呼び出しを必須にする' },
    schema: [],
  },
  create(context) {
    const TEST_NAMES = new Set(['it', 'test']);
    // 同一ファイル内で定義され、本体に expect を含むヘルパー関数名（Program で収集）
    const helperNames = new Set();

    function rootIdentifier(node) {
      while (node && node.type === 'MemberExpression') node = node.object;
      return node && node.type === 'Identifier' ? node.name : null;
    }

    // expect / assert 系、expectXxx / assertXxx という名前のヘルパー、同一ファイルの expect 入りヘルパー
    function isAssertionName(name) {
      if (!name) return false;
      return /^(expect|assert)/i.test(name) || helperNames.has(name);
    }

    function isFunctionNode(node) {
      return (
        !!node &&
        (node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression')
      );
    }

    function isTestCall(node) {
      // it(...), test(...), it.skip(...), test.each(...)(...) を対象にする
      let callee = node.callee;
      if (callee.type === 'CallExpression') callee = callee.callee; // it.each([...])('name', fn)
      const root = rootIdentifier(callee);
      return root !== null && TEST_NAMES.has(root);
    }

    function containsAssertion(node, seen = new Set()) {
      if (!node || typeof node !== 'object' || seen.has(node)) return false;
      seen.add(node);
      if (node.type === 'CallExpression' && isAssertionName(rootIdentifier(node.callee))) return true;
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue;
        const value = node[key];
        if (Array.isArray(value)) {
          if (value.some((v) => containsAssertion(v, seen))) return true;
        } else if (value && typeof value.type === 'string') {
          if (containsAssertion(value, seen)) return true;
        }
      }
      return false;
    }

    return {
      Program(program) {
        // トップレベルの function / const fn = () => {} のうち expect を含むものをヘルパーとして登録する
        for (const stmt of program.body) {
          if (stmt.type === 'FunctionDeclaration' && stmt.id && containsAssertion(stmt.body)) {
            helperNames.add(stmt.id.name);
          }
          if (stmt.type === 'VariableDeclaration') {
            for (const decl of stmt.declarations) {
              if (
                decl.id.type === 'Identifier' &&
                isFunctionNode(decl.init) &&
                containsAssertion(decl.init.body)
              ) {
                helperNames.add(decl.id.name);
              }
            }
          }
        }
      },
      CallExpression(node) {
        if (!isTestCall(node)) return;
        const body = node.arguments[node.arguments.length - 1];
        if (!body || (body.type !== 'ArrowFunctionExpression' && body.type !== 'FunctionExpression')) return;
        if (containsAssertion(body.body)) return;
        context.report({
          node,
          message:
            'このテストには expect / assert が無い。実行しただけではカバレッジは増えても検証にならない。期待値を書くか、テストを削除する。',
        });
      },
    };
  },
};

const config = [
  {
    ignores: [
      '.next',
      'next-env.d.ts',
      'scripts',
      'types',
      'coverage',
      // Supabase 自動生成。max-lines の対象外
      'src/types/database.types.ts',
    ],
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
      // 肥大化の可視化。warn 一覧は月次メンテの hotspot レビュー（docs/runbooks/monthly-maintenance.md）の入力
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['tests/**/*.{test,spec}.{ts,tsx}'],
    plugins: {
      'local-test': {
        rules: {
          'test-has-assertion': testHasAssertion,
        },
      },
    },
    rules: {
      'local-test/test-has-assertion': 'error',
    },
  },
];

export default config;
