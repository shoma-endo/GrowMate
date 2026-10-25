// design-sync の変換元を .design-sync/.cache/pkg/ に組み立てる（config の buildCmd）。
// GrowMate はアプリで dist/ も .d.ts も出さないため、src/components/ui だけの小さなパッケージを作る。
//   entry.ts      … 部品の barrel（変換の --entry）
//   types/        … tsc が出す .d.ts（Claude Design に渡す props の正本）
//   growmate.css  … app/globals.css を Tailwind v4 でコンパイルしたもの（config の cssEntry）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = resolve(root, '.design-sync/.cache/pkg');
mkdirSync(pkg, { recursive: true });

const uiFiles = readdirSync(resolve(root, 'src/components/ui'))
  .filter((f) => f.endsWith('.tsx'))
  .sort();
writeFileSync(
  resolve(pkg, 'entry.ts'),
  [
    ...uiFiles.map((f) => `export * from '../../../src/components/ui/${f.replace(/\.tsx$/, '')}';`),
    "export { cn } from '../../../src/lib/utils';",
    "export { toast } from 'sonner';",
    // lucide-react は Table・Badge など UI 部品と同名のアイコンを export するため、名前空間に分ける
    "export * as Icons from 'lucide-react';",
  ].join('\n') + '\n',
);
writeFileSync(
  resolve(pkg, 'package.json'),
  JSON.stringify({ name: 'growmate-ui', version: '0.1.0', private: true, types: 'index.d.ts' }, null, 2) + '\n',
);
writeFileSync(
  resolve(pkg, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../../../tsconfig.json',
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        incremental: false,
        rootDir: '../../..',
        outDir: 'types',
        plugins: [],
      },
      include: [],
      files: ['entry.ts'],
    },
    null,
    2,
  ) + '\n',
);
execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', resolve(pkg, 'tsconfig.json')], { stdio: 'inherit' });
writeFileSync(resolve(pkg, 'index.d.ts'), "export * from './types/.design-sync/.cache/pkg/entry';\n");

// 本番は next/font の Inter（latin）を <html> に当てている。日本語はその後ろの OS フォントで出る
const from = resolve(root, 'app/globals.css');
const to = resolve(pkg, 'growmate.css');
const css = await postcss([tailwind({ base: root })]).process(readFileSync(from, 'utf8'), { from, to });
writeFileSync(
  to,
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');\n" +
    css.css +
    "\nhtml, body { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }\n",
);
console.log(`wrote ${pkg}`);
