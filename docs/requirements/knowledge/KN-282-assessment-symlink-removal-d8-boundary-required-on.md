---
id: KN-282
type: knowledge
role: knowledge
title: "Assessment: Symlink-removal D8 — boundary required on the removal ports (2026-07-31)"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-10-23
tags: []
parent: PLAN-099
links:
  - {id: PLAN-099, type: informs}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01KYVEHPSKKCRGM1Z2QDDX921J`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SL-1 | 88 | Attested filtered run 'the measured incident' passes (2 passed / 19 skipped of 21). Behaviour of the refusal message and byte-identical survival is asserted inside the test, which is not visible here. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [5] attested) |
| AC-SL-2 | 86 | Attested 'declares its boundary' run passes (3 passed / 18 skipped). Vacuity control asserted in-test only; source of the scan not reviewable without a diff. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [6] attested) |
| AC-SL-3 | 87 | Attested 'removeDirIfEmpty must not abort' run passes (2 passed / 19 skipped). ENOTDIR/ENOTEMPTY/ENOENT distinctions not independently visible. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [7] attested) |
| AC-SL-5 | 86 | Attested 'removeProjectPath carries the same protection' run passes (2 passed / 19 skipped). The four post-conditions plus the three-call-site scan are bundled into 2 executed cases; granularity unverifiable. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [8] attested) |
| AC-SL-4 | 90 | Full suite run attested: 21/21 pass, zero failures, real-FS suite. Strongest single record in the bundle; the shrink hole it leaves open is by design and delegated to AC-SL-8. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [9] attested, [4] self-reported) |
| AC-SL-6 | 86 | Attested 'outside its boundary fails loud' run passes (3 passed / 18 skipped), consistent with the case-only-mismatch and target-equals-boundary cases both existing. Assertions not inspectable. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [10] attested) |
| AC-SL-7 | 58 | Only evidence is `bun run typecheck` pass — exactly the half the plan and task call non-load-bearing. No record of the negative-control fixture, and no discrimination proof (red when optional, green when required). A signature left optional produces identical evidence. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [11] attested, [1] self-reported; no negative-control run) |
| AC-SL-8 | 74 | Attested 'suite membership floor' run passes (1 passed / 20 skipped). Cannot confirm the floor is monotonic rather than an exact total — the failure mode this spec's history already hit once — nor what count it pins. | 01KYVEKZN08FD6Y0Z0FTTKT3GH (evidence [12] attested, [2] self-reported) |

## Gaps

- AC-SL-7 is evidenced solely by `bun run typecheck` passing. Both the plan's Risks section and the task brief state this proves nothing — an optional signature typechecks identically. The negative-control fixture that tsc must reject, and the required proof that it discriminates, produce no oracle record in this bundle. The AC as written is therefore satisfiable vacuously by the evidence shown.
- The core deliverable — `boundary` becoming a REQUIRED property on `remove` and `removeProjectPath` — cannot be confirmed from these materials. No diff, no signature excerpt, and a green typecheck under either signature. D8's explicit must-not-change (the runtime `if (opts?.boundary !== undefined)` branch stays reachable) is likewise unverified.
- The membership-floor test passes, but its output tail shows only '1 passed | 20 skipped' — no count. Whether the assertion is a monotonic floor (>= N) or an exact total (=== N) is undecidable here, and the exact-total variant is the precise regression this AC was amended to avoid.
- The task carries an explicit prohibition on committing packages/lore/src/generated/assets-manifest.ts (owned by a concurrent task). With diff_available=false there is no way to confirm compliance; a `bun run build` side effect could have swept it in unnoticed.
- 0 knowledge docs linked. This task is the direct mechanization of the retro 'Grepping the defect's shape finds it in the callee and misses every caller — one class, three escapes'; capturing the type-level-enumeration technique is the durable output and is absent.

## Recommendations

- For any AC whose pass condition is a compiler REJECTION, require the negative control to be its own evidence row with its own command and an inverted exit-code interpretation. Do not let it be implied by a broad `typecheck` pass.
- Make diff_available a gating precondition for auditing tasks whose deliverable is a type declaration, an interface shape, or a deletion-prohibition. Behavioural oracles are blind to all three.
- Require the discrimination proof the task text already demands ('show it red when the signature is optional and green when required') to be attached as a transcript, not merely instructed.
- Amend AC-SL-8's verify command so the floor test emits observed-vs-floor counts to stdout, making the monotonic-not-exact property visible in the attested output tail.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 68271ms
- Retried: false
- Truncated sections: task:task-t1-boundary-required-on-removal-ports-d8-ac-sl-7-8
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.7 | evidence | Regression floor AC-SL-1..6 fully green on a real-FS suite (21/21). The task's own headline deliverable, AC-SL-7's negative control, is asserted but unevidenced. |
| evidence_integrity | 68 | low | absence | 8 attested runs by a second recorder, ratio 0.67 — good. But the one oracle the plan named as load-bearing is missing, and no diff exists to cross-check any claim. |
| scope_fidelity | 72 | low | absence | No drift signal in the evidence; equally, no diff to confirm the runtime branch survived, doubles were tightened, or the manifest stayed uncommitted. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-SL-7 | AC-SL-7 is evidenced solely by `bun run typecheck` passing. Both the plan's Risks section and the task brief state this proves nothing — an optional signature typechecks identically. The negative-control fixture that tsc must reject, and the required proof that it discriminates, produce no oracle record in this bundle. The AC as written is therefore satisfiable vacuously by the evidence shown. |
| outcome | major | AC-SL-7 | The core deliverable — `boundary` becoming a REQUIRED property on `remove` and `removeProjectPath` — cannot be confirmed from these materials. No diff, no signature excerpt, and a green typecheck under either signature. D8's explicit must-not-change (the runtime `if (opts?.boundary !== undefined)` branch stays reachable) is likewise unverified. |
| outcome | minor | AC-SL-8 | The membership-floor test passes, but its output tail shows only '1 passed \| 20 skipped' — no count. Whether the assertion is a monotonic floor (>= N) or an exact total (=== N) is undecidable here, and the exact-total variant is the precise regression this AC was amended to avoid. |
| scope_fidelity | minor | — | The task carries an explicit prohibition on committing packages/lore/src/generated/assets-manifest.ts (owned by a concurrent task). With diff_available=false there is no way to confirm compliance; a `bun run build` side effect could have swept it in unnoticed. |
| evidence_integrity | minor | — | 0 knowledge docs linked. This task is the direct mechanization of the retro 'Grepping the defect's shape finds it in the callee and misses every caller — one class, three escapes'; capturing the type-level-enumeration technique is the durable output and is absent. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | For any AC whose pass condition is a compiler REJECTION, require the negative control to be its own evidence row with its own command and an inverted exit-code interpretation. Do not let it be implied by a broad `typecheck` pass. | The bundle currently cannot distinguish a required signature from an optional one — the exact failure the AC was written to prevent. |
| process | Make diff_available a gating precondition for auditing tasks whose deliverable is a type declaration, an interface shape, or a deletion-prohibition. Behavioural oracles are blind to all three. | diff_available=false left the required-ness change, the preserved runtime branch, and the manifest prohibition all unverifiable. |
| plan | Require the discrimination proof the task text already demands ('show it red when the signature is optional and green when required') to be attached as a transcript, not merely instructed. | The instruction exists in the task brief but produced no artifact, so it did not bind. |
| spec | Amend AC-SL-8's verify command so the floor test emits observed-vs-floor counts to stdout, making the monotonic-not-exact property visible in the attested output tail. | An exact total already drifted silently once in this spec's history; the current evidence cannot rule out its reintroduction. |

## Unverifiable Materials

- Implementation diff (no diff provided; diff_available=false): Cannot confirm boundary is required on remove/removeProjectPath, that the runtime undefined branch survives, or that test doubles were tightened.
- AC-SL-7 negative-control fixture and its oracle run: No evidence record for a tsc pass whose failure is the pass condition, and no red/green discrimination transcript.
- AC-SL-8 floor assertion source: Output tail shows no counts, so monotonic-floor vs exact-total cannot be distinguished.
- Commit contents re: packages/lore/src/generated/assets-manifest.ts: No diff or file list to confirm the concurrent-task-owned generated file was excluded.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.
- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.67

## Orchestrator correction (post-hoc, measured 2026-07-31 · agent:main-orchestrator)

Appended after the judgment was saved. The judge's own header reports
`diff_available=false`, `truncated: task:…`, and `Overall confidence: low
(degraded by truncation)` — the two findings below are artefacts of that blind
spot, not defects in the delivered work. Left in place above rather than
rewritten, so the judgment's provenance stays intact.

**The `evidence_integrity: major` and `outcome: major` findings on AC-SL-7 are
REFUTED.** Both assert that `bun run typecheck` cannot discriminate a required
`boundary` from an optional one, so the AC is "satisfiable vacuously by the
evidence shown". Measured on the merged commit:

| Check | Command | Result |
|---|---|---|
| Signature is required | `grep -n` on `real-setup-fs.ts` / `setup-service.ts` | `remove(path: string, opts: { boundary: string })` at `real-setup-fs.ts:192`, `removeProjectPath` at `:378`, port at `setup-service.ts:287` — all three non-optional |
| D8's must-not-change survived | same | runtime `if (opts?.boundary !== undefined)` retained at `:217` and `:390` |
| The negative control is REACHED by the oracle | `tsc -p packages/lore/tsconfig.tests.json --listFiles` | `setup-fs-boundary-required.type-fixture.ts` **is in the project's file set** (`include: ["src/**/*", "tests/**/*"]`) |
| Directives are load-bearing | `grep -c "@ts-expect-error"` on the fixture | 9, each on a call that omits `boundary` |

The discrimination therefore exists and rides on documented TypeScript
behaviour: an optional signature makes all nine annotated calls compile, the
directives become unused, `TS2578` fires, and `bun run typecheck` exits
non-zero. What made this invisible to the judge is that the mechanism lives in a
NEW FILE the diff-less bundle could not show — the fixture is the discriminator,
and `bun run typecheck` is merely the command that compiles it.

**Generalisable lesson (the reason this correction is worth its bytes):** an AC
whose pass condition is a compiler REJECTION cannot be audited from evidence
rows alone, because the passing signal is indistinguishable from the vacuous
one. The judge's own process recommendation — give such an AC its own evidence
row with an inverted exit-code interpretation — is the right fix and remains
open. Until then, auditing one requires reading the fixture, which is exactly
what a `diff_available=false` bundle forbids.

**Findings NOT refuted, and still open:**

- `outcome: minor` on AC-SL-8 — **RESOLVED by reading the source, no code change
  needed.** The finding was that the attested tail (`1 passed | 20 skipped`)
  carries no count, leaving monotonic-floor vs exact-total undecidable from the
  record. Measured directly in
  `packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts`: line 440 is
  `expect(collected).toBeGreaterThanOrEqual(SUITE_CASE_FLOOR)` — a floor, `>=`,
  not `===`. Two further assertions in the same case tighten it: `:452` pins the
  literal `const SUITE_CASE_FLOOR = <n>` declaration inside the file's own text
  (so the constant cannot be edited downward silently), and `:458` asserts
  `disabled` is empty, catching an `it.skip`/`it.todo`/`it.only` that would leave
  a case collected but not executed. The exact-total regression this AC was
  amended to prevent is therefore absent.

  Recorded rather than fixed on purpose: emitting the counts to stdout would make
  the property visible in the attested tail, but the property itself is already
  correct and pinned three ways, and the audit gap was that the RECORD did not
  say so. Putting the measurement in the record closes it without a spec
  amendment, a new plan, and an implementer dispatch whose only deliverable would
  be a `console.log`. If a future reader wants the tail to be self-describing,
  that remains a clean standalone improvement — but it is not a defect.
- `scope_fidelity: minor` on the manifest prohibition — since resolved
  independently: `git diff --name-only` across the merge shows
  `assets-manifest.ts` untouched by this task's commit, and a post-merge
  `bun run build` reported the manifest `verified fresh` with a clean tree.
- `evidence_integrity: minor`, 0 knowledge docs linked — addressed by
  `knowledge-measured-rmsync-unlinks-a-symlink-it-is-pointed-at`, authored in
  the same session and linked to the governing spec.
