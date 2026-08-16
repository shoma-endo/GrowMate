import { redirect } from 'next/navigation';
import GscDashboardClient from './GscDashboardClient';
import { fetchGscDetail } from '@/server/actions/gscDashboard.actions';

export const dynamic = 'force-dynamic';

export default async function GscDashboardPage({
  params,
}: {
  params: Promise<{ annotationId: string }>;
}) {
  const { annotationId: selectedId } = await params;

  let initialDetail = null;
  const res = await fetchGscDetail(selectedId);
  if (!res.success && res.emailLinkConflict) {
    redirect('/login?reason=email_link_conflict');
  }
  if (res.success) {
    initialDetail = res.data ?? null;
  }

  return <GscDashboardClient initialSelectedId={selectedId} initialDetail={initialDetail} />;
}
