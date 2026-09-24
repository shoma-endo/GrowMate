import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRON_CONFIGS } from '@/server/lib/cron-definitions';

interface WorkflowCronConfig {
  workflowId: string;
  routePath: string;
  profile: string;
  maxTime: number;
  maxRetries: number;
}

const WORKFLOW_DIR = '.github/workflows';

/**
 * cron を起動する workflow を**ファイル名で決め打ちしない**。
 *
 * 起動間隔が違う cron は別ファイルになる（毎時 = `hourly-cron.yml`、10分 =
 * `content-annotation-summary-cron.yml`）。`hourly-cron.yml` をハードコードしたままだと、
 * 新しい間隔の cron を足した瞬間に「宣言にあるが matrix に無い」で必ず落ちる。
 * `scripts/invoke-cron.sh` を呼ぶ workflow をすべて走査して matrix を集める。
 */
function readWorkflowCronConfigs(): WorkflowCronConfig[] {
  const files = readdirSync(WORKFLOW_DIR).filter(name => name.endsWith('.yml'));
  const configs: WorkflowCronConfig[] = [];

  for (const file of files) {
    const workflow = readFileSync(`${WORKFLOW_DIR}/${file}`, 'utf8');
    if (!workflow.includes('scripts/invoke-cron.sh')) continue;

    for (const block of workflow.split(/\n\s+- id: /).slice(1)) {
      configs.push({
        workflowId: block.match(/^([^\n]+)/)?.[1]?.trim() ?? '',
        routePath: block.match(/\n\s+path: ([^\n]+)/)?.[1]?.trim() ?? '',
        profile: block.match(/\n\s+profile: ([^\n]+)/)?.[1]?.trim() ?? '',
        maxTime: Number(block.match(/\n\s+maxTime: (\d+)/)?.[1]),
        maxRetries: Number(block.match(/\n\s+maxRetries: (\d+)/)?.[1]),
      });
    }
  }

  return configs;
}

/** `scripts/invoke-cron.sh` を呼ぶ workflow のファイル名と本文 */
function readInvokeCronWorkflows(): { file: string; source: string }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter(name => name.endsWith('.yml'))
    .map(file => ({ file, source: readFileSync(`${WORKFLOW_DIR}/${file}`, 'utf8') }))
    .filter(({ source }) => source.includes('scripts/invoke-cron.sh'));
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

  it('vercel.json と CRON_CONFIGS の route と schedule が一致する', () => {
    const config: unknown = JSON.parse(readFileSync('vercel.json', 'utf8'));
    if (typeof config !== 'object' || config === null || !('crons' in config)) {
      throw new Error('vercel.json に crons 配列がありません');
    }
    if (!Array.isArray(config.crons)) {
      throw new Error('vercel.json の crons は配列ではありません');
    }

    const vercelCrons = config.crons.map((cron: unknown) => {
      if (
        typeof cron !== 'object' ||
        cron === null ||
        !('path' in cron) ||
        typeof cron.path !== 'string' ||
        !('schedule' in cron) ||
        typeof cron.schedule !== 'string'
      ) {
        throw new Error('vercel.json の cron に path または schedule がありません');
      }
      return { path: cron.path, schedule: cron.schedule };
    });
    const declaredCrons = Object.values(CRON_CONFIGS).map(({ routePath, schedule }) => ({
      path: routePath,
      schedule,
    }));
    const byPath = (left: { path: string }, right: { path: string }) =>
      left.path.localeCompare(right.path);

    expect(vercelCrons.sort(byPath)).toStrictEqual(declaredCrons.sort(byPath));
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
  it('invoke-cron.sh を呼ぶ workflow に schedule trigger と schedule 条件が残っていない', () => {
    for (const { file, source } of readInvokeCronWorkflows()) {
      expect(source, `${file} に schedule trigger が残っている`).not.toMatch(/^\s*schedule:/m);
      expect(source, `${file} に github.event.schedule 条件が残っている`).not.toContain(
        'github.event.schedule'
      );
    }
  });

  it('起動が重なりうる workflow には concurrency がある', () => {
    for (const { file, source } of readInvokeCronWorkflows()) {
      expect(source, `${file} に concurrency が無い`).toContain('concurrency:');
      expect(source, `${file} が実行中の起動をキャンセルしている`).toContain(
        'cancel-in-progress: false'
      );
    }
  });
});
