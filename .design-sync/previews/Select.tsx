import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from 'growmate-ui';

export const Closed = () => (
  <div className="grid max-w-xs gap-2">
    <Label>期間</Label>
    <Select defaultValue="30">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="7">過去7日間</SelectItem>
        <SelectItem value="30">過去30日間</SelectItem>
        <SelectItem value="90">過去90日間</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Open = () => (
  <div className="h-56 max-w-xs">
    <Select defaultValue="30" open>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value="7">過去7日間</SelectItem>
        <SelectItem value="30">過去30日間</SelectItem>
        <SelectItem value="90">過去90日間</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
