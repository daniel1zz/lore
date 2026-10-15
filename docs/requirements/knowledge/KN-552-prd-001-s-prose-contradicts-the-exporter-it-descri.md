---
id: KN-552
type: knowledge
role: knowledge
title: "PRD-001's prose contradicts the exporter it describes, check:spec-mirror's exit code carries no signal, and the CLAUDE.md floor displaces its cost onto the next writer"
status: archived
priority: medium
created: 2026-08-25
updated: 2026-10-10
tags: []
parent: PRD-001
---
Three things measured while resuming handoff 128, each of which contradicted or sharpened the record I resumed from.

## F1 — PRD-001's own §5 states the OPPOSITE of what the exporter does, and the mirror check cannot say so

`prd-lore-internal-first-ai-team-knowledge-platform` §5 asserts, as a "known limitation":

> `OutlineService.resolve()` returns the placeholder data as a separate `resolvedComponents` array and leaves `content` verbatim ... So every plain-text projection — `lore get --resolve-mdx` stdout AND the SPEC-021 `export-docs` `.md` snapshot — shows the raw `<ChildrenOf />` tag

Measured 2026-08-25 against the live corpus and the live mirror:

| reader | `ChildrenOf` occurrences | shape |
|---|---|---|
| corpus body (`lore get --json` → `data.doc.content`) | 2 | bare `<ChildrenOf />` at body line 88 |
| mirror `docs/requirements/prd/PRD-001-lore-positioning.md` | 1 | 594 lines of EXPANDED child list where line 88 sits |

Corpus body is 15311 bytes; the mirror body is 94043 bytes. The export path therefore SPLICES the expansion, which is the behaviour §5 says it does not have. ⛔ The prose is not merely stale — it names the exact surface (`export-docs` `.md` snapshot) whose behaviour it gets backwards, so a reader who trusts it will conclude the permanent mirror drift is impossible.

⛔ Mechanism gap, unenforced: `bun run check:spec-mirror` detects that the body DIFFERS but cannot detect that a doc's own prose describes the diff wrongly. There is no oracle over "a doc's claim about a tool's behaviour matches the tool's behaviour". NOT BUILT.

## F2 — `check:spec-mirror`'s exit code is permanently non-zero, and one of its two drifts is fixable while the other is not

Measured with the exit code taken WITHOUT a pipe (`cmd > out 2>&1; echo $?`): **exit 2**, two drifting docs, and they have different causes that the report renders identically:

- `prd-lore-internal-first-ai-team-knowledge-platform` — STRUCTURAL and unfixable by re-export. The placeholder expands against the live corpus, so `lore export-docs --force` reconciles it for exactly as long as it takes any session anywhere to create one doc.
- `knowledge-five-findings-from-planning-the-github-read-side-a` — an ORDINARY un-exported update (the corpus body grew by findings F7/F8; corpus 15540 bytes vs mirror body 8404). `mirror:export` fixes it permanently.

⛔ The report prints both as `body differs from the corpus document` with the same remediation line (`Run lore export-docs --force`). For the first that remediation is a treadmill and for the second it is a fix, and nothing in the output distinguishes them. So the non-zero exit carries no signal: a reader cannot tell "someone forgot to export" from "this can never be zero".

⛔ First measurement of this was taken through a pipe (`bun run check:spec-mirror 2>&1 | tail -15; echo $?`), which reported the exit code of `tail` — 0 — and would have concluded the check was passing. The standing rule (measure exit codes off the pipe) exists precisely for this and still had to be caught by re-measurement.

## F3 — Adding one standing lesson to root CLAUDE.md forces an eviction, because the file sits AT the 0.97 floor

`lore status --check-claude-md` before the edit: 23814/24576 bytes, "within budget (0 findings)", plus two advisory approaching-ceiling warnings. The 0.97 eviction floor is 23838 bytes. So the file was 24 bytes below the floor: **any** addition of any size trips it. Adding one 406-byte line took it to 24221 and the check went to **exit 3** with a finding demanding an eviction.

What made the eviction cheap rather than a judgement call: the Standing-lessons section states its own shape rule — "one line each, scope keywords + a resolving slug, nothing restated" — and two entries were plainly violating it at 856 and 425 bytes of restated narrative. Compressing those two to pointer shape freed 766 bytes, and the destinations were verified to already carry the evicted text before deleting it (`to file/list`, `partial comparison`, `EQUALITY`, `anchors were THE SAME narrow set` present in the spec; `GENERIC`, `concatenation`, `blind spot`, `two-site` present in the knowledge doc). Final: 23634/24576, exit 0, with MORE headroom than before the addition.

⛔ Generalisable: a section that declares its own shape rule gives the next eviction a decidable target. Sections without one force the evictor to choose by taste. ⛔ And a file resting within a few bytes of its floor means the floor's warning fires on the NEXT writer, not the one who consumed the budget — the cost is displaced onto whoever comes next.

## CORRECTION to F2, measured 30 minutes after writing it

F2 above says KN-546's drift is "an ORDINARY un-exported update ... `mirror:export` fixes it permanently." ⛔ **That is false and I proved it myself.** `bun run mirror:export` ran to completion, exited 0, and printed `OK — every corpus knowledge has a mirror file` for every type; `bun run check:spec-mirror` immediately afterwards still reported the SAME three drifting bodies.

The reason is stated in the exporter's own output and I read past it: `(count and slug parity; file CONTENT is not compared)`. Write-mode `mirror:export` creates MISSING files; it does not rewrite EXISTING bodies. The command that reconciles bodies is the one the drift report actually names — `lore export-docs --force` — which then reported `⚠ Overwrote 3 drifted files (--force)` and took `check:spec-mirror` to exit 0.

⛔ Two different commands, one of which reports success while leaving the failure in place. `mirror:export`'s "OK" is scoped to a predicate (count/slug parity) narrower than the check that will later fail (body equality), and nothing in its output says the narrower predicate is all it measured. That is the same class as a `--dry-run` flag that does not exist: an affirmative report over a question that was never asked.

## F4 — the version/audit pairing is oracle-enforced at ONE of eighteen writer sites

AC-PHASEVER-4 now pins the pairing for `PhaseService`. Measured across `packages/lore/src/service/*.ts` on the merge commit:

- `store.updateWithProvenance(` — the atomic doc+version+audit composite — has call sites in exactly **3** files: `review-service.ts`, `corpus-service.ts`, `phase-service.ts`.
- **15** further services still perform the sequence as separate calls (`this.store.update(` … `this.store.insertVersion(` … `this.store.appendAuditEntry(`): `ac-service`, `drift-check-service`, `migration-service`, `ordinal-migration-service`, `outline-migration-service`, `phase-checklist-service`, `phase-migration-service`, `phase-workflow-service`, `plan-exemption-service`, `prd-outline-service`, `requirement-service`, `review-service`, `task-workflow-service`, `validity-service`, `version-service`.

⛔ Stated precisely, NOT overclaimed: in the happy path these are not severed — I read `DriftCheckService.writeCodeAnchors` and it does append an audit entry carrying `details.version`, so the `(doc_id, details.version)` join succeeds. `migration-service`'s version rows have no audit entry at all, but `AuditService`'s header shows v1-migration imports sit before the `since` watermark and are exempt BY DESIGN (D5). The residual is a partial write: three sequential `Result` returns with an early `return` between each, so a failure after `store.update` leaves a doc version with no version row, and a failure after `insertVersion` leaves the exact severed shape SPEC-148 C5 measured.

The point is not that these are broken today. It is that the property SPEC-148 just made oracle-enforced is enforced at 1 site out of 18, and the new suite's REGRESSION guard greps `phase-service.ts` alone. `knowledge-the-substring-matcher-lesson-has-a-mirror-face-over`'s "a structural AC is only as wide as the file list it greps" applies to the file list I approved.

## F5 — `bun run test` cannot return a verdict on this repo, and root CLAUDE.md describes it as if it could

`package.json`: `test = bun scripts/oracle-lock.ts sh -c "bun run check:ac-state-renderers && bun run test:vitest && bun run test:bun && bun run check:spec-mirror"`.

Root CLAUDE.md's Commands block described this as `# both runners in sequence`. It is four links, two of which are not runners, and the terminal link is the mirror check — which goes non-zero the moment ANY session creates ANY doc. So a green `bun run test` requires that no doc was created anywhere in the corpus between the last `lore export-docs --force` and the end of a ~5-minute run. Under the concurrency this project targets, that window is not obtainable.

Measured this session: `test:vitest` exited 1 (18 failures), so `test:bun` **never ran at all** and neither did `check:spec-mirror` — the chain short-circuited. That is `knowledge-a-gate-at-the-end-of-a-chain-is-never-invoked-while` reproducing exactly, in the repo that recorded it, on the command the CLAUDE.md tells a reader to use.

⇒ Read the two runners separately. `bun run test`'s exit code answers a question nobody asked.

## F6 — `result.status ?? 1` relabels a killed process as a process that exited 1

`scripts/tests/spec-mirror-export.test.ts` failed with `test setup: lore list --type knowledge --json --include-invalid failed (exit 1):` and an EMPTY stderr. Run by hand, that command exits **0** and writes **22,797,488 bytes** of stdout. The helper sets `maxBuffer: 20 * 1024 * 1024` — deliberately, citing this repo's spawnSync-truncation discipline — so `spawnSync` kills the child and returns `status: null`. Line 117 is `exitCode: result.status ?? 1`.

⛔ `?? 1` is a silent fallback in the exact place the project's own rule forbids one. It converts "killed, output truncated, measurement invalid" into "the CLI exited 1", and the test then reports a CLI failure that did not happen. The stderr being empty is the only surviving tell, and nothing asserts on it.

⛔ The trigger is corpus GROWTH, so this fails later and later for no reason a reader can see in the diff: at 551 knowledge docs the payload is 21.7 MB against a 20 MB ceiling. Whoever raises the ceiling buys time, not a fix — the fix is to fail loud on `status === null`.

## F7 — retiring an exemption row is part of declaring the anchor, and the row said so

SPEC-148 carried a `scripts/anchor-coverage-ledger.json` row whose reason ended: *"Retire this row in the same commit that declares real anchors, which becomes possible only if the ADR resolves toward changing the write path."* The ADR resolved that way and the write path changed, so this session declared four anchors — and the row instantly became a false claim that the spec has none. `check-anchor-coverage` has a reverse predicate for exactly this (`injecting a row for a real spec that ALREADY declares code_anchors exits EXACTLY 1`), so the stale row is caught rather than silently tolerated.

⛔ Worth recording anyway, because the coupling is invisible from `lore anchor add`: nothing in the anchor command mentions the ledger, and a session that adds anchors without grepping the ledger turns main red with no local signal. The row's own prose was the only pointer, and it is prose.

⛔ Also measured: `lore anchor add` on an APPROVED spec does NOT demote it (status stayed `approved`, v43 → v44). `DriftCheckService.writeCodeAnchors` carries `status: updateResult.value.status` into the version snapshot. So `anchor add` belongs with `ac add` and `phase add|rm` in the "logs a version, does not demote" family — a fourth member the root CLAUDE.md lifecycle paragraph does not list.
