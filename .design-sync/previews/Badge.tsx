import { Badge } from 'growmate-ui';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>連携済み</Badge>
    <Badge variant="secondary">目標達成</Badge>
    <Badge variant="destructive">要再連携</Badge>
    <Badge variant="outline">最終同期: 10/24 09:00</Badge>
  </div>
);
