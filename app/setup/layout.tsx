import type { ReactNode } from 'react';

import { requireSetupAuth } from '@/server/lib/require-setup-auth';

export const dynamic = 'force-dynamic';

export default async function SetupLayout({ children }: { children: ReactNode }) {
  await requireSetupAuth();
  return <>{children}</>;
}
