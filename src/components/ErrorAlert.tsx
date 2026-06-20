import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { LinkedMessage, type LinkedMessageRule } from '@/components/LinkedMessage';

const EMPTY_LINK_RULES: LinkedMessageRule[] = [];

interface ErrorAlertProps {
  error: string | null;
  variant?: 'destructive' | 'default';
  linkRules?: LinkedMessageRule[];
}

/**
 * エラーメッセージを表示するAlertコンポーネント
 * 必要に応じて呼び出し元から渡された linkRules で文言をリンクに変換する。
 */
export function ErrorAlert({
  error,
  variant = 'destructive',
  linkRules = EMPTY_LINK_RULES,
}: ErrorAlertProps) {
  // null または空文字の場合は何も表示しない
  if (!error) {
    return null;
  }

  return (
    <Alert variant={variant}>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <LinkedMessage message={error} rules={linkRules} />
      </AlertDescription>
    </Alert>
  );
}
