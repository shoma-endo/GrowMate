# GrowMate Project Knowledge

Use this project knowledge for GrowMate-specific TAKT workflows.

## Operating Model

- Human involvement stops at authoring/updating specs in `docs/plans/`.
- After a spec is ready, `spec-to-pr` / `react-doctor-to-pr` run unattended through implementation, internal review, and PR create/update.
- Do not ask humans for clarification mid-implementation. If the spec is insufficient, ABORT and leave concrete questions for the human to fix in `docs/plans/` before re-running.
- Requeue / resume / existing WIP / existing PR must continue the same branch and update the same PR when possible. Do not restart from a clean slate by default.

## Primary Sources

- `AGENTS.md` is the project-level operating rule.
- `.agents/skills/agent-workflow-core/SKILL.md` defines skill selection and client-alignment rules.
- `.agents/skills/implementation-guidelines/SKILL.md` defines TypeScript / Next.js / Supabase implementation policy.
- `.agents/skills/nextjs-server/SKILL.md` defines Server Actions, Route Handlers, Zod, and error handling rules.
- `.agents/skills/project-naming/SKILL.md` defines naming rules.
- `.agents/skills/react/SKILL.md` defines React 19 and React Compiler rules.
- `.agents/skills/growmate-ui-ux/SKILL.md` must be read before editing `app/**` or `src/components/**`.
- `.agents/skills/supabase/SKILL.md` must be read for Supabase, RLS, Service Role, migrations, and generated type changes.
- `.agents/skills/quality-gate/SKILL.md` defines verification and self-review.
- `.agents/skills/spec-review/SKILL.md` defines specification review checkpoints and routing.
- `.takt/workflows/spec-to-pr.yaml` and `.takt/workflows/react-doctor-to-pr.yaml` are the source workflows for PR automation. `.takt/workflows/spec-review.yaml` reviews a specification before spec-to-pr.
- `docs/plans/` contains implementation specifications.

## Required Verification

After code changes, run these checks unless the task explicitly scopes them out:

```bash
npm run lint
npm run test
npm run build
npm run knip
```

Prefer `npm run verify`, which runs all four in this order.

In unattended TAKT runs, the completion gate is `npm run verify` plus internal reviews (ai-antipattern / architecture / self-review). Do not block completion solely because browser manual testing was not performed; record it under PR 未確認事項 when UI changed.

Do not add simplified, placeholder, or low-value unit tests just to satisfy a workflow or reviewer. Add tests only when the user request or a referenced specification explicitly requires them, and only if they verify real business behavior at the correct boundary.

Architecture review should not reject a change solely because new tests were not added when the user request or referenced specification says tests are unnecessary or out of scope. In that case, evaluate correctness through production-code review and the required verification commands instead.

## Implementation Boundaries

- Keep changes minimal and aligned with existing code patterns.
- Fix implementation issues in production code directly; do not use new tests as a substitute for the requested fix.
- Do not edit generated files directly, including `src/types/database.types.ts`.
- If a spec requires a migration that is not yet applied to the shared remote DB (so the new table/column is absent from `database.types.ts`), this alone is NOT a reason to ABORT or stop mid-task. Apply the Pending Migration Types pattern in `.agents/skills/supabase/service-usage.md` §6 (`src/types/database.types.pending.ts` + `asPendingClient()`) and continue implementation to completion. Note the pending file(s) and required post-migration cleanup in the PR's 未確認事項. Remote migration apply (`supabase db push`) and `npm run supabase:types` remain manual admin steps performed after the PR merges; they do not block this workflow's completion.
- Do not read or print `.env*`, credentials, tokens, or other secret files.
- If a task touches `app/**` or `src/components/**`, read `.agents/skills/growmate-ui-ux/SKILL.md` before planning or implementation.
- For server-side validation, prefer Zod schemas and export types with `z.infer`.
- Do not use `any`; use `unknown` with narrowing or a schema.
- For React 19, prefer `use(Context)` over `useContext()`, and prefer `<Context value={...}>` over `<Context.Provider value={...}>`.
- Do not add `useMemo`, `useCallback`, or `memo()` unless a concrete external API stability requirement exists.

## PR Requirements

- Commit messages must be a single Japanese line.
- For `spec-to-pr` and `react-doctor-to-pr`, the TAKT workflow owns PR creation and the PR body. `.github/workflows/auto-pr.yml` is only a fallback for non-TAKT pushes and must not overwrite an existing PR body.
- Do not post `@codex` review requests from auto-pr; architecture / antipattern / self-review already run inside the TAKT workflow.
- PR titles (from `pr-summary.md` leading `# ` line) must be Japanese, one line, ≤50 characters, and convey What/Why. Do not use `[Auto]`, branch-name-only titles, self-congratulatory phrases, English-only titles, or conventional-commit prefixes.
- PR bodies (from `pr-summary.md`) should include: 概要, 関連仕様書（applicable）, 変更要点, レビュー結果, 完了判断（事実と意見を分離）, 検証結果, 未確認事項.
- On re-run, prefer updating an existing open PR for the same head/base over creating a new one.
- Open architecture-reviewer findings must be resolved before the workflow completes.
- If the only open finding is a test-addition request that conflicts with the user request or referenced specification, document it as a policy exception instead of looping on fix.
