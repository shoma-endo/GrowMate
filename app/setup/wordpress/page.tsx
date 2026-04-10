import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import WordPressSettingsForm from '@/components/WordPressSettingsForm';
import { getWordPressSettings } from '@/server/actions/wordpress.actions';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';

export const dynamic = 'force-dynamic';

export default async function WordPressSetupPage() {
  const cookieStore = await cookies();
  const liffAccessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;

  // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
  const authResult = await authMiddleware(liffAccessToken, refreshToken);
  redirectIfEmailLinkConflict(authResult);
  if (authResult.error || !authResult.userDetails?.role) {
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
