# GrowMate Project Knowledge

Use this project knowledge for GrowMate-specific TAKT workflows.

## Operating Model

- Human involvement stops at authoring/updating specs in `docs/plans/`.
- After a spec is ready, `spec-to-pr` runs unattended through implementation, internal review, and PR create/update.
- Do not ask humans for clarification mid-implementation. If the spec is insufficient, ABORT and leave concrete questions for the human to fix in `docs/plans/` before re-running.
- Requeue / resume / existing WIP / existing PR must continue the same branch and update the same PR when possible. Do not restart from a clean slate by default.

## Workflow Sources

- `AGENTS.md` is the project-level operating rule.
- `docs/templates/requirement-definition.md` is the checklist for implementation-ready requirements: purpose, scope, functional and non-functional requirements, constraints, trade-offs, risks, and release verification.
- `.takt/workflows/grill-to-gherkin.yaml` clarifies requirements interactively, produces Gherkin acceptance criteria, and stops at human approval before any spec or code edit.
- `.takt/workflows/spec-review.yaml` reviews specifications before implementation.
- `.takt/workflows/spec-to-pr.yaml` is the source workflow for unattended implementation, review, and PR creation/update.
- The approved Gherkin is not automatically copied into a spec. Follow `04-handoff.md`, reflect it into the target `docs/plans/<slug>.md`, then run `spec-review` and `spec-to-pr` explicitly.
- `.agents/skills/` contains implementation-specific rules; the workflow loads relevant Skills when needed.
- `docs/plans/` contains implementation specifications.
