import { Input, Label } from 'growmate-ui';

export const WithField = () => (
  <div className="grid max-w-sm gap-2">
    <Label htmlFor="title">記事タイトル</Label>
    <Input id="title" defaultValue="中小企業のためのSEO入門" />
  </div>
);
