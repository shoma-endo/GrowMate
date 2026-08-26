# GrowMate Project Knowledge

Use this project knowledge for GrowMate-specific TAKT workflows.

## Operating Model

- Human involvement stops at authoring/updating specs in `docs/plans/`.
- After a spec is ready, `spec-to-pr` runs unattended through implementation, internal review, and PR create/update.
- Do not ask humans for clarification mid-implementation. If the spec is insufficient, ABORT and leave concrete questions for the human to fix in `docs/plans/` before re-running.
- Requeue / resume / existing WIP / existing PR must continue the same branch and update the same PR when possible. Do not restart from a clean slate by default.

## Delivery Principle: MVP First

- **GrowMate prioritizes MVP delivery above all else. When a judgment call is unclear, use this as one of the deciding axes.**
- Do not add functionality that the requirements do not ask for — including drive-by fixes, future abstractions, and safety machinery (kill switches, feature flags, dedicated settings tables, monitoring dashboards, redundancy, retry infrastructure).
- Safety machinery is in scope **only when** (a) the requirements or the client agreement explicitly ask for it, (b) leaving the broken state unattended would corrupt data, keep sending wrong data to an external service, or run up billing, or (c) existing means (rollback, hiding the feature UI, an existing env flag) cannot stop it.
- Satisfying a review checklist is not a goal in itself. A checklist item never justifies inventing a requirement.
- When you decide not to build something, record it in the target spec's Non-goals with the reason. Do not silently omit it.
- Concrete failure this rule exists to prevent (2026-08-19): the GA4 content-evaluation spec grew a dedicated `ga4_content_evaluation_settings` kill-switch table, an RPC-level `enabled is true` check, stop-state UI, a business rule, an acceptance criterion, and rollback steps — none of which the client asked for. It had no write path, so enabling it required raw SQL against production. The user's feedback: "requirements-free work got in; we are being excessively cautious about security."

## Default Access Policy

- New features are available to `admin` and `paid` users by default.
- `trial` and `unavailable` users are excluded unless the target specification explicitly approves an exception.
- Authorization must be enforced server-side in addition to any UI gating. Every feature specification must document the role matrix and unauthorized behavior.

## Workflow Sources

- `AGENTS.md` is the project-level operating rule.
- `docs/templates/requirement-definition.md` is the checklist for implementation-ready requirements: purpose, scope, functional and non-functional requirements, constraints, trade-offs, risks, and release verification.
- `.takt/workflows/grill-to-gherkin.yaml` expects TAKT standard `grill-me` as the interactive mode (select Grill Me at startup, or switch with `/interaction` during the conversation). It normalizes the resulting Markdown instruction into a report, records recommended reuse/extend implementation options against existing code (without inventing requirements), and requires human approval for both the Gherkin and the rough-estimate go/no-go decision before any spec or code edit.
- TAKT v0.62+ applies Gherkin guidance only to development/implementation tasks. `assistant.gherkin` is removed; do not rely on `/go` always emitting Gherkin. The dedicated `gherkin` step in `grill-to-gherkin` still produces and validates acceptance criteria as Gherkin.
- After Gherkin approval, `grill-to-gherkin` creates `05-rough-estimate.md` with a range, assumptions, uncertainty, and exclusions. This is an internal rough estimate for go/no-go and prioritization, not a formal quote.
- After the rough estimate, `06-estimate-confirmation.md` records the human decision: `着手承認`, `要件再確認が必要`, or `見送り`. Only `着手承認` proceeds to handoff.
- `.takt/workflows/spec-review.yaml` reviews specifications before implementation.
- `.takt/workflows/spec-to-pr.yaml` is the source workflow for unattended implementation, review, and PR creation/update.
- In `spec-to-pr`, the second and later `reviewers` passes are follow-up: previous review reports and `fix-result.md` are attached, findings are tracked by `finding_id` (`resolved` / `persists` / `new` / `reopened`), and residuals that cannot be fixed in code are recorded as `cannot_fix` so the loop can exit instead of spinning.
- The approved Gherkin is not automatically copied into a spec. Follow `04-handoff.md`, reflect it into the target `docs/plans/<slug>.md`, then run `spec-review` and `spec-to-pr` explicitly.
- `.agents/skills/` contains implementation-specific rules; the workflow loads relevant Skills when needed.
- `docs/plans/` contains implementation specifications.
