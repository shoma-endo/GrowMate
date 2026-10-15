import WordPressImportClient from './WordPressImportClient';

// 初回の全件取得は記事数に比例して長くなり、記事が多いサイトでは既定の300秒では足りないことがある。
// このページの Server Action（一括インポート）も日次 cron と同じ上限にする
export const maxDuration = 800;

export default function WordPressImportPage() {
  return <WordPressImportClient />;
}
