/**
 * WordPressエラー診断ユーティリティ
 */

interface ErrorDiagnosis {
  cause: string;
  hints: string[];
}

/**
 * WordPressエラーメッセージを診断し、原因とヒントを返す
 *
 * @param errorMessage - エラーメッセージ
 * @returns エラー診断結果（原因とヒント）
 */
export function diagnoseWordPressError(errorMessage: string): ErrorDiagnosis {
  const lower = (errorMessage || '').toLowerCase();

  if (!errorMessage) {
    return {
      cause: '不明なエラー',
      hints: ['時間をおいて再試行してください', '状況が続く場合はサポートへ連絡してください'],
    };
  }

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('token')) {
    return {
      cause: '認証エラー（トークンの欠如・期限切れ・無効）',
      hints: [
        'WordPress.comのOAuth認証をやり直してください',
        'セルフホストの場合はユーザー名/アプリパスワードを再確認してください',
      ],
    };
  }

  if (lower.includes('404') || lower.includes('not found')) {
    return {
      cause: 'エンドポイント未検出またはサイトID/URL誤り',
      hints: [
        'WordPressサイトID（.com）またはサイトURL（セルフホスト）を確認してください',
        'REST APIが有効か（セルフホスト）確認してください',
      ],
    };
  }

  if (lower.includes('http') && lower.includes('settings')) {
    return {
      cause: 'REST API設定エンドポイントにアクセスできません',
      hints: [
        'Basic認証情報（ユーザー名/アプリパスワード）を確認してください',
        'セキュリティプラグイン等でREST APIがブロックされていないか確認してください',
      ],
    };
  }

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
    return {
      cause: 'ネットワークエラー（接続失敗/タイムアウト）',
      hints: [
        'サイトURLのスペルやHTTPS有無を確認してください',
        '一時的な障害の可能性があります。時間を置いて再試行してください',
      ],
    };
  }

  return {
    cause: 'エラーが発生しました',
    hints: ['入力内容を確認し、再度お試しください'],
  };
}
