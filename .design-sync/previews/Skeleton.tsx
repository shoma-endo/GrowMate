import { Skeleton } from 'growmate-ui';

export const Loading = () => (
  <div className="grid max-w-sm gap-3">
    <Skeleton className="h-6 w-1/2" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-5/6" />
    <div className="flex gap-3 pt-2">
      <Skeleton className="h-20 flex-1" />
      <Skeleton className="h-20 flex-1" />
    </div>
  </div>
);
