import { redirect } from 'next/navigation';
import WordPressSettingsForm from '@/components/WordPressSettingsForm';
import { getWordPressSettings } from '@/server/actions/wordpress.actions';
import { requireSetupAuth } from '@/server/lib/require-setup-auth';

export const dynamic = 'force-dynamic';

export default async function WordPressSetupPage() {
  const authResult = await requireSetupAuth();
  if (!authResult.userDetails?.role) {
    redirect('/login');
  }
  // Setup pages should be accessible to owners at all times

  // 既存のWordPress設定を取得
  let existingWordPressSettings = null;
  try {
    existingWordPressSettings = await getWordPressSettings();
  } catch (error) {
    console.error('[WordPress Setup] Failed to fetch settings:', error);
  }

  return (
    <WordPressSettingsForm
      existingSettings={existingWordPressSettings}
      role={authResult.userDetails.role}
    />
  );
}
