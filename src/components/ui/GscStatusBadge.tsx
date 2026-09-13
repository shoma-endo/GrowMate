import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface GscStatusBadgeProps {
  connected: boolean;
  needsReauth: boolean;
  /** refresh tokenは生きているが一時的に確認できない状態。needsReauthとは排他 */
  hasTemporaryError?: boolean;
}

/**
 * Google Search Console / GA4 共通のステータスバッジコンポーネント
 * （名前はGSC由来だがGa4SetupClientからも使う。汎用の連携ステータス表示として扱う）
 *
 * 優先度：再認証 > 一時的失敗 > 接続済み > 未設定
 */
export function GscStatusBadge({ connected, needsReauth, hasTemporaryError }: GscStatusBadgeProps) {
  // 再認証が必要な場合は「要再認証」バッジを表示
  if (needsReauth) {
    return (
      <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200">
        <AlertTriangle className="mr-1 h-4 w-4" />
        要再認証
      </Badge>
    );
  }
  // refresh tokenは生きているが確認できていないだけなので「未確認」として区別する
  if (hasTemporaryError) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">
        <AlertCircle className="mr-1 h-4 w-4" />
        未確認
      </Badge>
    );
  }
  if (connected) {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
        <CheckCircle2 className="mr-1 h-4 w-4" />
        接続済み
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-gray-700">
      <AlertCircle className="mr-1 h-4 w-4" />
      未設定
    </Badge>
  );
}
