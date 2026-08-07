import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRON_CONFIGS } from '@/server/lib/cron-definitions';

interface WorkflowCronConfig {
  workflowId: string;
  routePath: string;
  profile: string;
  maxTime: number;
  maxRetries: number;
}

function readWorkflowCronConfigs(): WorkflowCronConfig[] {
  const workflow = readFileSync('.github/workflows/hourly-cron.yml', 'utf8');
  const blocks = workflow.split(/\n\s+- id: /).slice(1);

  return blocks.map(block => ({
    workflowId: block.match(/^([^\n]+)/)?.[1]?.trim() ?? '',
    routePath: block.match(/\n\s+path: ([^\n]+)/)?.[1]?.trim() ?? '',
    profile: block.match(/\n\s+profile: ([^\n]+)/)?.[1]?.trim() ?? '',
    maxTime: Number(block.match(/\n\s+maxTime: (\d+)/)?.[1]),
    maxRetries: Number(block.match(/\n\s+maxRetries: (\d+)/)?.[1]),
  }));
}

describe('cron config consistency', () => {
  it('宣言とGitHub Actions matrixが一致する', () => {
    const declared = Object.values(CRON_CONFIGS)
      .map(({ workflowId, routePath, profile, maxTime, maxRetries }) => ({
        workflowId,
        routePath,
        profile,
        maxTime,
        maxRetries,
      }))
      .sort((left, right) => left.workflowId.localeCompare(right.workflowId));
    const workflow = readWorkflowCronConfigs().sort((left, right) =>
      left.workflowId.localeCompare(right.workflowId)
    );

    expect(workflow).toStrictEqual(declared);
  });

  it.each(Object.values(CRON_CONFIGS))(
    '$workflowId のRouteと実行時間設定が宣言と一致する',
    config => {
      const route = readFileSync(`app${config.routePath}/route.ts`, 'utf8');
      const maxDuration = Number(route.match(/export const maxDuration = (\d+)/)?.[1]);

      expect(maxDuration).toBe(config.maxDuration);
      expect(config.maxTime).toBeGreaterThan(config.maxDuration);
    }
  );

  it.each(Object.values(CRON_CONFIGS))('$workflowId のprofileが呼び出しスクリプトに存在する', config => {
    const script = readFileSync('scripts/invoke-cron.sh', 'utf8');

    expect(script).toContain(`${config.profile})`);
  });

  it('呼び出しスクリプトが503と504を断定せずに分類する', () => {
    const script = readFileSync('scripts/invoke-cron.sh', 'utf8');

    expect(script).toContain('cron_timeout_type=PLATFORM_OR_SERVICE_UNAVAILABLE');
    expect(script).toContain('cron_timeout_type=GATEWAY_OR_FUNCTION_TIMEOUT_INFERRED');
    expect(script).not.toContain('cron_timeout_type=FUNCTION_HARD_TIMEOUT_INFERRED');
  });
});
