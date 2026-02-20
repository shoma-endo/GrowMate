import type { UserRole } from '@/types/user';

interface Ga4PermissionParams {
  role: UserRole | null;
  ownerUserId: string | null | undefined;
  viewMode?: boolean;
}

const GA4_ALLOWED_ROLES: UserRole[] = ['admin', 'paid', 'owner'];

export function canAccessGa4(params: Ga4PermissionParams): boolean {
  const { role, ownerUserId } = params;
  if (!role || !GA4_ALLOWED_ROLES.includes(role)) {
    return false;
  }
  if (ownerUserId) {
    return false;
  }
  return true;
}

export function canWriteGa4(params: Ga4PermissionParams): boolean {
  if (!canAccessGa4(params)) {
    return false;
  }
  return !params.viewMode;
}
