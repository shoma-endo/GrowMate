import { GscStatusBadge } from 'growmate-ui';

export const States = () => (
  <div className="flex flex-wrap items-center gap-2">
    <GscStatusBadge connected needsReauth={false} />
    <GscStatusBadge connected needsReauth={false} hasTemporaryError />
    <GscStatusBadge connected needsReauth />
    <GscStatusBadge connected={false} needsReauth={false} />
  </div>
);
