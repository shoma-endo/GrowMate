import { Label, Textarea } from 'growmate-ui';

export const States = () => (
  <div className="grid max-w-md gap-4">
    <div className="grid gap-2">
      <Label htmlFor="biz">事業の説明</Label>
      <Textarea id="biz" placeholder="例: 東京都内で中小企業向けにホームページ制作をしています" />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="ng">使わない言い回し</Label>
      <Textarea id="ng" defaultValue={'「業界No.1」\n「絶対に」'} rows={3} />
    </div>
  </div>
);
