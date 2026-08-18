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

function taktAvailable(): boolean {
  try {
    execFileSync('takt', ['--version'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

// doctor 0.58.0 は loop_monitor judge 経由の到達辺を実行順を無視して評価する。
// spec-to-pr の prepare_pr_summary への全辺（self_review の pass / self_review サイクル監視 judge）は
// self-review.md 生成後にしか通らないため、この WARN は誤検知としてベースライン化する。
// ここに無い WARN が新たに出たらテストが落ちる（黙殺しない）。
const KNOWN_DOCTOR_WARNINGS: Record<string, RegExp[]> = {
  'spec-to-pr.yaml': [/prepare_pr_summary.*\{report:self-review\.md\}/],
};

describe.skipIf(!taktAvailable())('takt workflow doctor', () => {
  it.each(workflowFiles)('%s is accepted by the installed takt', (file) => {
    const output = execFileSync('takt', ['workflow', 'doctor', path.join('.takt', 'workflows', file)], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
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
