import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'takt-check-base-branch.sh');

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ol-034-test',
      GIT_AUTHOR_EMAIL: 'ol-034@example.com',
      GIT_COMMITTER_NAME: 'ol-034-test',
      GIT_COMMITTER_EMAIL: 'ol-034@example.com',
      ...env,
    },
  }).trim();
}

function createFixture(): { bare: string; work: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'ol-034-'));
  tempRoots.push(root);

  const bare = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  mkdirSync(seed);

  git(seed, ['init', '-b', 'develop']);
  writeFileSync(path.join(seed, 'README.md'), 'root\n');
  git(seed, ['add', 'README.md']);
  git(seed, ['commit', '-m', 'root']);

  git(seed, ['checkout', '-b', 'main']);
  writeFileSync(path.join(seed, 'main-only.txt'), 'main\n');
  git(seed, ['add', 'main-only.txt']);
  git(seed, ['commit', '-m', 'main tip']);

  git(seed, ['checkout', 'develop']);
  writeFileSync(path.join(seed, 'develop-only.txt'), 'develop\n');
  git(seed, ['add', 'develop-only.txt']);
  git(seed, ['commit', '-m', 'develop tip']);

  git(seed, ['clone', '--bare', seed, bare]);

  const work = path.join(root, 'work');
  git(root, ['clone', bare, work]);
  git(work, ['remote', 'set-url', 'origin', bare]);

  return { bare, work };
}

function runCheck(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bash', [SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('takt-check-base-branch.sh', () => {
  it('① develop 起点ブランチで origin/develop を含む → exit 0', () => {
    const { work } = createFixture();
    git(work, ['checkout', '-b', 'feature/from-develop', 'origin/develop']);

    const result = runCheck(work);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/基準ブランチ: origin\/develop@[0-9a-f]+ \/ HEAD: feature\/from-develop@[0-9a-f]+/);
  });

  it('② main 起点（origin/develop を含まない）→ exit 非 0、stderr に behind 数', () => {
    const { work } = createFixture();
    git(work, ['checkout', '-b', 'feature/from-main', 'origin/main']);

    const result = runCheck(work);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/behind=\d+/);
    expect(result.stderr).toMatch(/origin\/develop/);
  });

  it('③ develop が進んで HEAD が取り残されている → exit 非 0', () => {
    const { bare, work } = createFixture();
    git(work, ['checkout', '-b', 'feature/stale', 'origin/develop']);

    const pushSeed = path.join(path.dirname(bare), 'push-seed');
    git(path.dirname(bare), ['clone', bare, pushSeed]);
    git(pushSeed, ['checkout', 'develop']);
    writeFileSync(path.join(pushSeed, 'newer.txt'), 'newer\n');
    git(pushSeed, ['add', 'newer.txt']);
    git(pushSeed, ['commit', '-m', 'develop advanced']);
    git(pushSeed, ['push', 'origin', 'develop']);

    const result = runCheck(work);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/behind=\d+/);
  });

  it('④ fetch 失敗（remote URL を存在しないパスにする）→ exit 非 0', () => {
    const { work } = createFixture();
    git(work, ['checkout', '-b', 'feature/ok', 'origin/develop']);
    expect(runCheck(work).status).toBe(0);

    git(work, ['remote', 'set-url', 'origin', path.join(path.dirname(work), 'does-not-exist.git')]);

    const result = runCheck(work);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/fetch/);
  });

  it('⑤ remote.origin.fetch が develop をマップしない構成でも最新 tip で判定する', () => {
    const { bare, work } = createFixture();
    git(work, ['checkout', '-b', 'feature/restricted-fetch', 'origin/develop']);

    git(work, ['config', '--unset-all', 'remote.origin.fetch']);
    git(work, ['config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main']);

    const pushSeed = path.join(path.dirname(bare), 'push-seed-restricted');
    git(path.dirname(bare), ['clone', bare, pushSeed]);
    git(pushSeed, ['checkout', 'develop']);
    writeFileSync(path.join(pushSeed, 'restricted-newer.txt'), 'newer\n');
    git(pushSeed, ['add', 'restricted-newer.txt']);
    git(pushSeed, ['commit', '-m', 'develop advanced under restricted refmap']);
    git(pushSeed, ['push', 'origin', 'develop']);

    const result = runCheck(work);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/behind=\d+/);
  });
});
