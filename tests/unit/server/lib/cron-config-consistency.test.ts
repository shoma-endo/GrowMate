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

/** cron を起動する workflow のファイル名と、その `schedule` の cron 式 */
function readWorkflowSchedules(): { file: string; schedules: string[] }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter(name => name.endsWith('.yml'))
    .map(file => ({ file, source: readFileSync(`${WORKFLOW_DIR}/${file}`, 'utf8') }))
    .filter(({ source }) => source.includes('scripts/invoke-cron.sh'))
    .map(({ file, source }) => ({
      file,
      schedules: [...source.matchAll(/- cron: '([^']+)'/g)].map(match => match[1] ?? ''),
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
  /**
   * **`if` の schedule 文字列を cron 式と一致させる。**
   * 既存 workflow をコピーして cron 式だけ変えると、`github.event.schedule == '0 * * * *'`
   * のガードが残り、`workflow_dispatch` では動くのに定期実行だけ何もしない workflow になる。
   */
  it('各ステップの if ガードが自分の schedule と一致する', () => {
    for (const { file, schedules } of readWorkflowSchedules()) {
      const source = readFileSync(`${WORKFLOW_DIR}/${file}`, 'utf8');
      const guards = [...source.matchAll(/github\.event\.schedule == '([^']+)'/g)].map(
        match => match[1] ?? ''
      );
      expect(guards.length, `${file} に schedule ガードが無い`).toBeGreaterThan(0);
      for (const guard of guards) {
        expect(schedules, `${file} の if ガード ${guard} が schedule に無い`).toContain(guard);
      }
    }
  });

  it('起動が重なりうる workflow には concurrency がある', () => {
    for (const { file } of readWorkflowSchedules()) {
      const source = readFileSync(`${WORKFLOW_DIR}/${file}`, 'utf8');
      expect(source, `${file} に concurrency が無い`).toContain('concurrency:');
      expect(source, `${file} が実行中の起動をキャンセルしている`).toContain(
        'cancel-in-progress: false'
      );
    }
  });
});
