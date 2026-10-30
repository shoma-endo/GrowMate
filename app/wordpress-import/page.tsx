import WordPressImportClient from './WordPressImportClient';

// 初回の全件取得は記事数に比例して長くなり、記事が多いサイトでは既定の300秒では足りないことがある。
export const maxDuration = 800;

export default function WordPressImportPage() {
  return <WordPressImportClient />;
}
