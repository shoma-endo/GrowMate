import { redirect } from 'next/navigation';
import GscDashboardClient from './GscDashboardClient';
import { fetchGscDetail } from '@/server/actions/gscDashboard.actions';
import { fetchGa4ContentEvaluation } from '@/server/actions/ga4ContentEvaluation.actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export default async function GscDashboardPage({
  params,
}: {
  params: Promise<{ annotationId: string }>;
}) {
  const { annotationId: selectedId } = await params;

  let initialDetail = null;
  const res = await fetchGscDetail(selectedId);
  const ga4Evaluation = await fetchGa4ContentEvaluation(selectedId);
  if (!res.success && res.emailLinkConflict) {
    redirect('/login?reason=email_link_conflict');
  }
  if (res.success) {
    initialDetail = res.data ?? null;
  }

  return <GscDashboardClient initialSelectedId={selectedId} initialDetail={initialDetail} initialGa4Evaluation={ga4Evaluation.success ? ga4Evaluation.data : null} />;
}
