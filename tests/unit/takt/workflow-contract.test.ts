// .takt/workflows と .takt/schemas の contract テスト。
// takt workflow doctor は schema ファイル欠落と when() 文法しか静的検証しないため、
// ステップ名・フィールド名の typo（runtime abort になる）と enum 網羅・report 参照をここで塞ぐ。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.takt', 'workflows');
const SCHEMAS_DIR = path.join(REPO_ROOT, '.takt', 'schemas');
const RESOLVE_TAKT_BIN = path.join(REPO_ROOT, 'scripts', 'resolve-takt-bin.sh');
const VERSION_FILE = path.join(REPO_ROOT, '.takt-version');

interface WorkflowRule {
  condition: string;
  next: string;
}

interface WorkflowStep {
  name: string;
  structured_output?: { schema_ref: string };
  rules?: WorkflowRule[];
  output_contracts?: { report?: { name: string }[] };
  parallel?: WorkflowStep[];
}

interface Workflow {
  name: string;
  steps: WorkflowStep[];
  loop_monitors?: unknown[];
}

interface Schema {
  type: string;
  properties: Record<string, { enum?: string[] }>;
  required: string[];
  additionalProperties: boolean;
}

const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((file) => file.endsWith('.yaml'));
const schemaFiles = readdirSync(SCHEMAS_DIR).filter((file) => file.endsWith('.json'));

function loadWorkflow(file: string): { workflow: Workflow; raw: string } {
  const raw = readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
  return { workflow: YAML.parse(raw) as Workflow, raw };
}

function loadSchema(ref: string): Schema {
  return JSON.parse(readFileSync(path.join(SCHEMAS_DIR, `${ref}.json`), 'utf8')) as Schema;
}

/**
 * GrowMate の takt 正本はリポジトリ直下の `.takt-version`。
 * 実体は `~/.local/takt/<version>/bin/takt`（`scripts/takt-install-pinned.sh`）。
 * PATH / Homebrew / ai-os の pin にはフォールバックしない。
 * ローカルでは未設置・版不一致を skip せず fail（設置手順をエラーに出す）。
 * CI で pin 未設置のときは doctor 系だけ skip（1GB 設置は別途。ローカル pre-push が主戦場）。
 */
function resolveTaktBin(): string {
  try {
    return execFileSync(RESOLVE_TAKT_BIN, {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    }).trim();
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: Buffer | string }).stderr ?? '')
        : '';
    throw new Error(
      stderr.trim() ||
        `takt pin を解決できません。./scripts/takt-install-pinned.sh を実行してください（正本: ${VERSION_FILE}）`,
    );
  }
}

function tryResolveTaktBin(): { bin: string } | { error: string } {
  try {
    return { bin: resolveTaktBin() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const taktResolve = tryResolveTaktBin();
const taktBin = 'bin' in taktResolve ? taktResolve.bin : null;
const taktResolveError = 'error' in taktResolve ? taktResolve.error : null;
/** ローカルは pin 必須。CI のみ未設置を許容して skip する */
const runPinnedTaktTests = taktBin !== null || !isCi;

// doctor は follow-up 用に reviewers / self_review_fix が「前回レポート」を参照すると、
// 初回到達では未生成でも WARN になる（runtime は欠落文に置換）。意図的な参照なのでベースライン化する。
// ここに無い WARN が新たに出たらテストが落ちる（黙殺しない）。
const KNOWN_DOCTOR_WARNINGS: Record<string, RegExp[]> = {
  'spec-to-pr.yaml': [
    /prepare_pr_summary.*\{report:self-review\.md\}/,
    /step "reviewers" references \{report:fix-result\.md\}/,
    /step "reviewers" references \{report:ai-antipattern-review\.md\}/,
    /step "reviewers" references \{report:architecture-review\.md\}/,
    /step "self_review_fix" references \{report:fix-result\.md\}/,
  ],
};

describe.skipIf(!runPinnedTaktTests)('takt pin', () => {
  it('resolves the binary declared by .takt-version', () => {
    const want = readFileSync(VERSION_FILE, 'utf8').trim();
    expect(want).toMatch(/^\d+\.\d+\.\d+$/);
    expect(taktBin, taktResolveError ?? 'takt pin unresolved').toBeTruthy();
    const got = execFileSync(taktBin as string, ['--version'], { encoding: 'utf8' }).trim();
    expect(got).toBe(want);
  });
});

describe('unattended prepare portability', () => {
  it('keeps prepare scripts inside the repository (no machine-absolute paths)', () => {
    for (const file of workflowFiles) {
      const raw = readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
      const preparePaths = [...raw.matchAll(/^\s*-\s+(\S+\.sh)\s*$/gm)].map((m) => m[1] as string);
      for (const entry of preparePaths) {
        expect(entry, `${file} prepare must be repo-relative`).not.toMatch(/^\/Users\//);
        expect(entry.startsWith('scripts/'), `${file} unexpected prepare: ${entry}`).toBe(true);
        expect(existsSync(path.join(REPO_ROOT, entry)), `missing ${entry}`).toBe(true);
      }
    }
    expect(existsSync(path.join(REPO_ROOT, 'scripts', 'takt-check-provider-auth.sh'))).toBe(true);
    expect(existsSync(path.join(REPO_ROOT, 'scripts', 'takt-run-unattended.sh'))).toBe(true);
  });

  it('enables workflow_runtime_prepare.custom_scripts in project config', () => {
    const config = YAML.parse(readFileSync(path.join(REPO_ROOT, '.takt', 'config.yaml'), 'utf8')) as {
      provider?: string;
      workflow_runtime_prepare?: { custom_scripts?: boolean };
    };
    expect(config.provider).toBe('claude-sdk');
    expect(config.workflow_runtime_prepare?.custom_scripts).toBe(true);
  });
});

describe.skipIf(!runPinnedTaktTests)('takt workflow doctor', () => {
  it.each(workflowFiles)('%s is accepted by the pinned takt', (file) => {
    expect(taktBin, taktResolveError ?? 'takt pin unresolved').toBeTruthy();
    let output: string;
    try {
      output = execFileSync(taktBin as string, ['workflow', 'doctor', path.join('.takt', 'workflows', file)], {
        encoding: 'utf8',
        cwd: REPO_ROOT,
      });
    } catch (error) {
      const stdout =
        error && typeof error === 'object' && 'stdout' in error
          ? String((error as { stdout?: Buffer | string }).stdout ?? '')
          : '';
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? String((error as { stderr?: Buffer | string }).stderr ?? '')
          : '';
      output = `${stdout}${stderr}`;
      expect(output, `doctor failed for ${file}`).not.toMatch(/\[ERROR\]/);
      throw error;
    }
    expect(output).not.toMatch(/\[ERROR\]/);
    const warnings = output.split('\n').filter((line) => line.includes('[WARN]'));
    const allowlist = KNOWN_DOCTOR_WARNINGS[file] ?? [];
    for (const warning of warnings) {
      expect(
        allowlist.some((pattern) => pattern.test(warning)),
        `unexpected doctor warning: ${warning}`,
      ).toBe(true);
    }
    if (warnings.length === 0) {
      expect(output).toMatch(/Workflow OK/);
    }
  });
});

describe('structured output schemas', () => {
  it.each(schemaFiles)('%s is strict with a non-empty verdict enum', (file) => {
    const schema = JSON.parse(readFileSync(path.join(SCHEMAS_DIR, file), 'utf8')) as Schema;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(schema.properties)));
    expect(schema.properties.verdict?.enum?.length).toBeGreaterThan(0);
  });
});

describe.each(workflowFiles)('%s structured references', (file) => {
  const { workflow, raw } = loadWorkflow(file);
  const stepsByName = new Map(workflow.steps.map((step) => [step.name, step]));

  // when(structured.<step>.<field>) と {structured:<step>.<field>} の全参照を集める
  const references = [
    ...raw.matchAll(/when\(structured\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g),
    ...raw.matchAll(/\{structured:([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\}/g),
  ].map((m) => ({ stepName: m[1] as string, field: m[2] as string }));

  it('resolves every structured reference to a declared schema field (typo = runtime abort)', () => {
    for (const { stepName, field } of references) {
      const step = stepsByName.get(stepName);
      expect(step, `step "${stepName}" referenced but not defined`).toBeDefined();
      const schemaRef = step?.structured_output?.schema_ref;
      expect(schemaRef, `step "${stepName}" has no structured_output`).toBeTruthy();
      expect(existsSync(path.join(SCHEMAS_DIR, `${schemaRef}.json`))).toBe(true);
      const schema = loadSchema(schemaRef as string);
      expect(Object.keys(schema.properties), `unknown field "${stepName}.${field}"`).toContain(field);
    }
  });

  it('routes every structured step deterministically over the full verdict enum', () => {
    for (const step of workflow.steps) {
      const schemaRef = step.structured_output?.schema_ref;
      if (!schemaRef) continue;
      const schema = loadSchema(schemaRef);
      const enumValues = schema.properties.verdict?.enum ?? [];
      const routed: string[] = [];
      for (const rule of step.rules ?? []) {
        const match = rule.condition.match(
          new RegExp(`^when\\(structured\\.${step.name}\\.verdict == "([A-Za-z0-9_]+)"\\)$`),
        );
        expect(match, `step "${step.name}" has a non-deterministic rule: ${rule.condition}`).toBeTruthy();
        routed.push(match![1] as string);
      }
      expect(new Set(routed), `step "${step.name}" does not cover the verdict enum`).toEqual(
        new Set(enumValues),
      );
    }
  });

  it('resolves every {report:X} injection to an output contract in the same workflow', () => {
    // parallel 親ステップの output_contracts は子ステップ側にある
    const allSteps = workflow.steps.flatMap((step) => [step, ...(step.parallel ?? [])]);
    const producedReports = new Set(
      allSteps.flatMap((step) => (step.output_contracts?.report ?? []).map((entry) => entry.name)),
    );
    const reportReferences = [...raw.matchAll(/\{report:([^}]+)\}/g)].map(([, name]) => name);
    for (const name of reportReferences) {
      expect(producedReports, `{report:${name}} has no producing output_contract`).toContain(name);
    }
  });
});
