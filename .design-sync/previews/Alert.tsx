import { Alert, AlertDescription, AlertTitle } from 'growmate-ui';

export const Variants = () => (
  <div className="grid gap-3">
    <Alert>
      <AlertTitle>データの反映には2〜3日かかります</AlertTitle>
      <AlertDescription>Google Search Console の数値は、2〜3日前までの分が表示されます。</AlertDescription>
    </Alert>
    <Alert variant="success">
      <AlertTitle>設定を保存しました</AlertTitle>
      <AlertDescription>明日の朝から、検索の成果が毎日取り込まれます。</AlertDescription>
    </Alert>
    <Alert variant="destructive">
      <AlertTitle>データ取得に失敗しました</AlertTitle>
      <AlertDescription>Google との連携が切れています。設定画面からもう一度連携してください。</AlertDescription>
    </Alert>
  </div>
);
