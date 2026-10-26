import { Avatar } from 'growmate-ui';

export const Initials = () => (
  <div className="flex items-center gap-3">
    <Avatar>
      <span className="flex size-full items-center justify-center bg-muted text-xs font-medium">山田</span>
    </Avatar>
    <Avatar className="size-10">
      <span className="flex size-full items-center justify-center bg-primary text-sm font-medium text-primary-foreground">GM</span>
    </Avatar>
    <div className="flex items-center gap-2">
      <Avatar>
        <span className="flex size-full items-center justify-center bg-secondary text-xs font-medium">佐藤</span>
      </Avatar>
      <span className="text-sm">佐藤 花子</span>
    </div>
  </div>
);
