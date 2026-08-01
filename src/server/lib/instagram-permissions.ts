import type { UserRole } from '@/types/user';

interface InstagramPermissionParams {
  userId: string;
  role: UserRole | null;
}

const INSTAGRAM_ALLOWED_ROLES: UserRole[] = ['admin', 'paid', 'trial'];

function parseBetaUserIds(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function isRoleAllowed(role: UserRole | null): boolean {
  return Boolean(role && INSTAGRAM_ALLOWED_ROLES.includes(role));
}

export function canAccessInstagram(params: InstagramPermissionParams): boolean {
  const { userId, role } = params;
  const betaUserIds = parseBetaUserIds(process.env.INSTAGRAM_BETA_USER_IDS);

  if (betaUserIds.length > 0) {
    return betaUserIds.includes(userId);
  }

  return isRoleAllowed(role);
}
