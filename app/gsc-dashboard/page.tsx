import { redirect } from 'next/navigation';
import GscDashboardClient from './GscDashboardClient';
import { fetchGscDetail } from '@/server/actions/gscDashboard.actions';

type SearchParams = { annotationId?: string | string[] };

export const dynamic = 'force-dynamic';

export default async function GscDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const selectedId =
    typeof resolvedSearchParams.annotationId === 'string' ? resolvedSearchParams.annotationId : null;

  let initialDetail = null;
  if (selectedId) {
    const res = await fetchGscDetail(selectedId);
    if (!res.success && res.emailLinkConflict) {
      redirect('/login?reason=email_link_conflict');
    }
    if (res.success) {
      initialDetail = res.data ?? null;
    }
  }

  return <GscDashboardClient initialSelectedId={selectedId} initialDetail={initialDetail} />;
}
