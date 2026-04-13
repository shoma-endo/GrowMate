import type { UserRole } from '@/types/user';

// =========================
// クライアント安全なヘルパー
// =========================
export function isAdmin(role: UserRole | null): boolean {
  return role === 'admin';
}

export function isUnavailable(role: UserRole | null): boolean {
  return role === 'unavailable';
}

export function getRoleDisplayName(role: UserRole | null): string {
  switch (role) {
    case 'admin':
      return '管理者';
    case 'trial':
      return 'お試しユーザー';
    case 'paid':
      return '有料契約ユーザー';
    case 'unavailable':
      return 'サービス利用停止';
    default:
      return '不明';
  }
}
