---
id: TASK-363
type: task
role: plan
title: "The ac-scope re-keying left the red-first floor unarmed for the shape it created, plus three named residuals from the capture-window slice"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-06
tags: []
parent: PRD-001
links:
  - {id: ADR-029, type: relates-to}
---
# Defect — the ac-scope re-keying left the red-first floor unarmed for the shape it created

`task-an-ad-hoc-task-can-never-reach-the-attestation-path-that` (merged `3b20514`) made
`--ac-scope` required on the `--adhoc` branch, with `--ac-scope ""` as the explicit-empty
declaration. Its own doc claimed the change "arms this floor too, for free" for the red-first
floor. **Measured on `main` — that is true only for a NON-EMPTY scope.**

`packages/lore/src/service/task-workflow-service.ts:754-757`, verified in source by the
orchestrator:

```
function requiresNoNewTestsDeclaration(task: DocRecord, evidence: EvidenceEntry[]): boolean {
  const acScope = extractDeclaredAcScope(task);
  if (acScope === undefined || acScope.length === 0) return false;
```

An empty array short-circuits identically to an absent one. So an ad-hoc task declaring
`--ac-scope ""` — now the ONLY way to create an ad-hoc task, and therefore the dominant shape —
still archives with no red evidence row and no `red_first` declaration, and nothing asks.
Every ad-hoc task this session created uses the explicit-empty form.

⛔ This is a scoping question, not an obvious bug: an empty scope genuinely claims no criterion,
so "which ACs went red" has no answer for it. The floor's PURPOSE, though, is to ask whether the
author worked red-first at all — which is answerable regardless of scope. Decide explicitly:
either the floor keys on something other than `ac_scope` length (e.g. "this task touched source
files" via `extra.file_anchors`), or the empty case is exempted IN WRITING with the reason.
⛔ Do not silently leave it, and ⛔ do not make `--ac-scope ""` synthesize a fake criterion.

# Second face — `lore report-issue` bypasses the flag the requiredness is keyed on

`packages/core/src/issue-report.ts:187` — `buildIssueReportExtra` writes `extra.adhoc: true`
directly, never through the CLI `--adhoc` flag. The new requiredness lives at the CLI layer
(deliberately: the predicate needs the author's flag, which only the CLI sees), so inbound
consumer bug reports still land with an ABSENT `ac_scope`.

Arguably correct — a reporting project cannot know the upstream's AC ids — but it is a policy
call that is currently made by omission. Decide and record it: either `report-issue` writes an
explicit empty scope (making the claim auditable, matching what the CLI now demands of authors),
or the bypass is documented as intended at that write site.

This is the SAME shape as the defect the re-keying closed: a requiredness keyed on one writer's
surface while a second writer reaches the field another way. It is the third such pair in this
corpus (`isPlanMember` copies, the two claim writers and `session_id`, and now this).

# Third face — three named residuals from the capture-window slice (merged `4732832`)

1. `packages/lore/src/adapters/mcp/tools.ts` does not pass a config-resolved capture window, so
   `lore_evidence_add {capture: true}` always runs at the 600 000 ms default while the CLI
   honours `workflow.evidence.capture_timeout_ms`. The loud-timeout half IS shared, so MCP
   already refuses correctly — only the configurability is missing. One-line fix:
   `timeoutMs: resolveCaptureTimeoutMs(config)`.
2. A malformed `capture_timeout_ms` degrades to the default SILENTLY, because
   `loadProjectConfig` returns `undefined` on any parse failure. Pre-existing `loader.ts`
   behaviour for every non-`ai` section (a documented SPEC-030 non-goal) — fixing it changes
   every section at once, which is why it was not fixed in that slice. Already pinned by test
   `CAPCLI-E1`, so a future fix flips a failing test rather than changing semantics silently.
   ⛔ Scope this deliberately: it is a config-loader-wide decision, not a capture-window one.
3. `assets/project/lore-config-template.yaml` does not carry the new key. **Orchestrator
   decision, recorded rather than deferred:** it stays out. The key ships in the Zod schema, so
   `lore` honours it for every consumer, and the refusal message names both the knob and the
   file at the moment an author needs them. Seeding it would require an assets-manifest regen
   for a key most consumers never touch. ⛔ If a future slice adds it, regenerate the manifest
   in the SAME commit — `assets/` pairs are parity-pinned.

# Fourth face — a JSDoc that is true but now incomplete

`packages/lore/src/service/gate-predicates.ts`'s `acScopeRequiredAtCreate` JSDoc says the
predicate "simply never fires for [an ad-hoc task]". Still literally true — the gate predicate
was deliberately NOT changed — but a reader now concludes the ad-hoc branch is unconstrained.
It must name the CLI-layer sibling (`isAdhocAcScopeDeclarationMissing` in
`create-task-validation.ts`) as the mechanism that DOES bind that branch.

# Oracle

- Face 1: whichever decision is taken, assert BOTH branches in one test — an ad-hoc task with
  an empty scope and no red row either refuses at `lore done` or archives under a recorded
  exemption, and the OTHER outcome is asserted absent. ⛔ Asserting only the chosen branch
  passes against today's silent behaviour.
- Face 2: a `lore report-issue`-created task's stored `extra` either carries `ac_scope: []` or
  the write site carries the documented rationale — assert the STORED value, not the exit code.
- Face 3.1: `lore_evidence_add {capture: true}` in a fixture corpus with a small configured
  window refuses loudly; the same call with the default window captures. Both ends of the diff
  plus a live control, per the pattern that slice already established.
- Face 4: a grep oracle for the sibling's name in that JSDoc, with an inverse control (a grep
  that must NOT match, proving the oracle is not vacuous) — the pattern
  `agent:fix-adhoc-ac-scope` used for the `verify.ts` paragraph.
- Fixture corpora are throwaway (`mkdtemp` + `lore init`), ⛔ NEVER this repo's `.lore/`.
- Measure every exit code WITHOUT a pipe (`cmd > out 2>&1; echo $?`).

Distribution surface: binary-side (`packages/lore/**`, `packages/core/**`) — all four faces ship
to the two named consumers with the next build.
