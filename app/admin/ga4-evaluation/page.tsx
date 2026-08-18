import { redirect } from 'next/navigation';
import Ga4EvaluationSettingsClient from './Ga4EvaluationSettingsClient';
import { fetchGa4EvaluationSettings } from '@/server/actions/adminGa4Evaluation.actions';

export const dynamic = 'force-dynamic';

export default async function Ga4EvaluationSettingsPage() {
  const result = await fetchGa4EvaluationSettings();

  if (!result.success && 'emailLinkConflict' in result && result.emailLinkConflict) {
    redirect('/login?reason=email_link_conflict');
  }

  if (!result.success) {
    return (
      <Ga4EvaluationSettingsClient
        initialEnabled={false}
        initialUpdatedAt={null}
        initialError={result.error}
      />
    );
  }

  return (
    <Ga4EvaluationSettingsClient
      initialEnabled={result.data.enabled}
      initialUpdatedAt={result.data.updatedAt}
    />
  );
}
