type DeploymentSuccessLevel = 'success' | 'warning' | 'critical' | 'no-data';

export interface DeploymentSuccessEvaluation {
  level: DeploymentSuccessLevel;
  message: string;
}

export function evaluateDeploymentSuccess(
  readyCount: number,
  totalCount: number
): DeploymentSuccessEvaluation {
  if (totalCount === 0) {
    return {
      level: 'no-data',
      message: '  ℹ️ 過去7日間のデプロイメントがありません。成功率の判定をスキップします。',
    };
  }
  const successRate = readyCount / totalCount;
  if (successRate >= 0.95) {
    return { level: 'success', message: '  ✅ 正常: デプロイメント成功率が95%以上です。' };
  }
  if (successRate >= 0.8) {
    return {
      level: 'warning',
      message: '  ⚠️  注意: デプロイメント成功率が80%以上ですが、改善の余地があります。',
    };
  }
  return {
    level: 'critical',
    message: '  ❌ 警告: デプロイメント成功率が80%未満です。調査が必要です。',
  };
}

// Vercel APIは認証・認可の失敗を本文の `error.message` にしか載せないことがあるため、
// ステータスごとに確認先を添えた1行に整形する（トークン自体は含めない）。
export function describeVercelApiError(
  status: number,
  detail: string,
  hasTeamId: boolean
): string {
  const base = `Vercel APIエラー (HTTP ${status})${detail ? `: ${detail}` : ''}`;
  if (status === 401) {
    return `${base}。トークンが無効または期限切れの可能性があります。GitHub Secrets の VERCEL_TOKEN を再発行して更新してください。`;
  }
  if (status === 403) {
    const teamHint = hasTeamId
      ? ''
      : 'Vercel チーム所属のプロジェクトでは VERCEL_TEAM_ID が必須です。';
    return `${base}。トークンにプロジェクトへのアクセス権がありません。VERCEL_TOKEN のスコープ・有効期限、対象チームへの所属、VERCEL_PROJECT_ID / VERCEL_TEAM_ID の値を確認してください。${teamHint}`;
  }
  if (status === 404) {
    return `${base}。プロジェクトが見つかりません。VERCEL_PROJECT_ID の値を確認してください。`;
  }
  return base;
}
