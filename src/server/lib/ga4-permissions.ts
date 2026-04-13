import type { UserRole } from '@/types/user';

interface Ga4PermissionParams {
  role: UserRole | null;
}

const GA4_ALLOWED_ROLES: UserRole[] = ['admin', 'paid'];

export function canAccessGa4(params: Ga4PermissionParams): boolean {
  const { role } = params;
  return Boolean(role && GA4_ALLOWED_ROLES.includes(role));
}

export function canWriteGa4(params: Ga4PermissionParams): boolean {
  return canAccessGa4(params);
}
