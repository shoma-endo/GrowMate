import { Skeleton } from '@/components/ui/skeleton';

export function PageLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="画面を読み込んでいます"
      className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8"
    >
      <div className="space-y-3">
        <Skeleton className="h-9 w-48 max-w-full" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full sm:col-span-2 xl:col-span-1" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
