import type { UserRole } from '@/types/user';

// =========================
// クライアント安全なヘルパー
// =========================
export function isAdmin(role: UserRole | null): boolean {
  return role === 'admin';
}

// AI要約（単記事・一括）は一時的に管理者限定。解除時は呼び出し元を元の判定へ戻す
// （単記事はロール判定なし、一括は canWriteGa4）
export function canUseContentAnnotationSummary(role: UserRole | null): boolean {
  return isAdmin(role);
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
