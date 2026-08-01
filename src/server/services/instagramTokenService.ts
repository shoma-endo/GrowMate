import 'server-only';
import { ensureValidInstagramToken } from '@/server/lib/instagram-token';
import { InstagramService } from '@/server/services/instagramService';

export { ensureValidInstagramToken };

export function createInstagramTokenDeps(
  userId: string,
  persist: (payload: {
    accessToken: string;
    accessTokenExpiresAt: string;
    accessTokenIssuedAt: string;
  }) => Promise<void>
) {
  const instagramService = new InstagramService();
  return {
    refreshLongLivedToken: (token: string) => instagramService.refreshLongLivedToken(token),
    persistToken: persist,
    now: new Date(),
  };
}
