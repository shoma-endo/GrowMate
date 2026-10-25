import { Input, Label } from 'growmate-ui';

export const States = () => (
  <div className="grid max-w-sm gap-4">
    <div className="grid gap-2">
      <Label htmlFor="site">サイトの URL</Label>
      <Input id="site" placeholder="https://example.com" />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="kw">狙うキーワード</Label>
      <Input id="kw" defaultValue="ホームページ制作 費用" />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="ro">連携中のアカウント</Label>
      <Input id="ro" defaultValue="growmate@example.com" disabled />
    </div>
  </div>
);
