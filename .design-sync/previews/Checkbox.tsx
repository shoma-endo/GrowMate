import { Checkbox, Label } from 'growmate-ui';

export const States = () => (
  <div className="grid gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="c1" defaultChecked />
      <Label htmlFor="c1">評価が終わったらメールで知らせる</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="c2" />
      <Label htmlFor="c2">公開済みの記事だけを表示する</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="c3" disabled />
      <Label htmlFor="c3">Google Analytics 4 の指標も使う（GA4 が未連携のため選べません）</Label>
    </div>
  </div>
);
