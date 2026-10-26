import { Button, Icons } from 'growmate-ui';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>取り込む</Button>
    <Button variant="secondary">下書きに保存</Button>
    <Button variant="outline">キャンセル</Button>
    <Button variant="ghost">詳細を見る</Button>
    <Button variant="destructive">削除する</Button>
    <Button variant="link">設定を開く</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">小</Button>
    <Button>標準</Button>
    <Button size="lg">大</Button>
    <Button size="icon" variant="outline" aria-label="再読み込み">
      <Icons.RefreshCwIcon />
    </Button>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="outline" className="inline-flex items-center gap-2">
      <Icons.DownloadIcon className="size-4" />
      ひな形をダウンロード
    </Button>
    <Button disabled>
      <Icons.Loader2Icon className="size-4 animate-spin" />
      生成中...
    </Button>
    <Button disabled variant="outline">ファイルを選択</Button>
  </div>
);
