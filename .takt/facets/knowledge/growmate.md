# GrowMate Project Knowledge

Use this project knowledge for GrowMate-specific TAKT workflows.

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
npm run build
npm run knip
```

For UI changes, perform manual browser verification appropriate to the changed screen.

Do not add simplified, placeholder, or low-value unit tests just to satisfy a workflow or reviewer. Add tests only when the user request or a referenced specification explicitly requires them, and only if they verify real business behavior at the correct boundary.

Architecture review should not reject a change solely because new tests were not added when the user request or referenced specification says tests are unnecessary or out of scope. In that case, evaluate correctness through production-code review and the required verification commands instead.

## Implementation Boundaries

- Keep changes minimal and aligned with existing code patterns.
- Fix implementation issues in production code directly; do not use new tests as a substitute for the requested fix.
- Do not edit generated files directly, including `src/types/database.types.ts`.
- Do not read or print `.env*`, credentials, tokens, or other secret files.
- If a task touches `app/**` or `src/components/**`, read `.agents/skills/growmate-ui-ux/SKILL.md` before planning or implementation.
- For server-side validation, prefer Zod schemas and export types with `z.infer`.
- Do not use `any`; use `unknown` with narrowing or a schema.
- For React 19, prefer `use(Context)` over `useContext()`, and prefer `<Context value={...}>` over `<Context.Provider value={...}>`.
- Do not add `useMemo`, `useCallback`, or `memo()` unless a concrete external API stability requirement exists.

## PR Requirements

- Commit messages must be a single Japanese line.
- PR bodies should include summary, changes, verification results, Codex architecture review results, and related spec file when applicable.
- Open architecture-reviewer findings must be resolved before the workflow completes.
- If the only open finding is a test-addition request that conflicts with the user request or referenced specification, document it as a policy exception instead of looping on fix.
