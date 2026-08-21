---
id: SPEC-139
type: spec
role: spec
title: "The defect channel cannot be honestly maintained: an unreleasable cap whose remedy is inert, two reads that disagree on which corpus, and no non-derogatory supersession"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-21
tags: []
parent: PRD-001
---
# Overview

The upstream defect channel (`lore report-issue` / `lore issues` / `lore issue resolve`,
SPEC-072 + spec-issue-closure-loop-computed-resolution-agent-reachable) is the ONLY
path a consuming project has to tell this repo that lore is broken. A downstream
consumer measured it on 2026-08-10/11 and found the channel refuses new reports with
a remedy that provably does not work, its two read surfaces disagree 0-vs-12 on the
same queue, and neither the queue nor the evidence log can record that one record
SUPERSEDES another without also DEROGATING it.

Three findings, one shared shape: **the corpus has terminal states that destroy a
claim's standing (`rejected`, `wontfix`, `invalidate`) but none that merely retire it
in favour of a better one, and the surfaces that count these records do not agree on
what they are counting or on which corpus they read.**

## Measured, not inferred

**F1 — the cap is unreleasable by any action available to the reporter, and its
error message names a remedy that is inert.** Probe on two throwaway corpora
(`/tmp/lore-cap-probe-9RhKyJ`, 2026-08-11, upstream + consumer, real compiled
binary):

1. Filed 10 reports → all accepted.
2. 11th → refused, exit 4: `already has 10 open report(s) upstream (cap 10) —
   resolve or wait for review on: <10 ULIDs>`.
3. Resolved ALL 10 upstream with `lore issue resolve <id> --state rejected --reason
   …` → every one reported `resolution: rejected`; `lore issues --all` upstream
   confirmed 10 rows at `rejected`.
4. 12th report → **refused with the byte-identical cap message, still naming all 10
   ULIDs.** Upstream doc status census after resolution: `10 × "status": "draft"`.

Mechanism: the cap counts raw lifecycle status (`countOpenReports`,
`packages/core/src/issue-report.ts:161`, `if (task.status !== "draft") continue`)
while `lore issue resolve` writes ONLY `extra.issue_report.resolution`
(`commands/issue.ts:191-197`) and `VALID_TRANSITIONS` has no `draft → archived` edge,
so no closure verb can move the doc off `draft` at all. The reporter's original
report ("quota can only be freed by declaring a real defect not-a-defect") was
GENEROUS: dishonesty does not free it either. The prescribed `resolve` is not a
degraded remedy, it is a false one — and a false remedy in a refusal message is worse
than no remedy, because it costs the caller a round trip to discover the refusal is
unconditional.

**F2 — `lore issues` and `lore report-issue --list` read DIFFERENT corpora and
neither says so.** Same instant, same cwd, in the consumer project: `lore issues
--all` → `(no all issue reports)`; `lore issues --open --json` → `total: 0`;
`lore report-issue --list` → 12 rows (10 open / 2 closed). `issues.ts:139` calls
`loadLoreApp()`, i.e. the corpus discovered from cwd — correct only when run
UPSTREAM-side; `report-issue --list` reads the local receipt ledger joined against
the configured upstream. Both help strings claim to be about upstream reports
("upstream-side, agent-reachable" / "live upstream status"). The cap counts the side
`--list` can see; the command an agent is steered toward reports `0`, which reads as
"the queue is empty, file freely".

**F3 — an AC that reverses its oracle's polarity leaves two mutually-exclusive
attested passes side by side.** `AC-BG-5` in a consumer corpus carries 7 evidence
rows across two contradictory commands — `grep -rq MARKER apps/web` (marker MUST
exist) and `! grep -rq MARKER …` (marker MUST NOT exist) — of which ev28 and ev6 are
BOTH attested `exit_code: 0`. Four candidate write paths were read: `lore evidence`
(append-only, no supersede/amend), `lore invalidate` (whole-document granularity —
retiring the task would also void its 29 unrelated valid rows), `lore audit`
(read-only), `lore set` (evidence not in the field whitelist). `deriveAcCoverageState`
already has a `fail_superseded` state, but it keys on a fail superseded by a newer
ATTESTED PASS — it cannot see two passes of opposite polarity, so this pair reads as
ordinary green.

# Scope

In scope — three mechanisms, each landing on a surface that ships:

- **M1 — the cap counts computed resolution, not raw status, and the refusal names a
  remedy that works.** `IssueReportService.report`'s step-6 candidate set is narrowed
  by the SHARED terminal-resolution set before counting: a report whose computed
  resolution is terminal no longer occupies quota. The private const
  `TERMINAL_RESOLUTIONS` (`commands/issues.ts:64`) is promoted to the exported SSOT
  **`TERMINAL_ISSUE_RESOLUTIONS`** in `service/issue-resolution.ts` and consumed by
  BOTH the listing filter and the cap count — one definition of "terminal", never
  two. That name is used verbatim everywhere in this spec; there is no second
  spelling.

  **Declared contract — the refusal payload is STRUCTURED, not prose to be
  re-parsed.** The cap refusal's `LoreError.value` carries
  `{blocking: Array<{id: string, resolution: IssueResolution}>,
  quota_freeing_states: string[]}`. `quota_freeing_states` is DERIVED from
  `TERMINAL_ISSUE_RESOLUTIONS` at construction time, never written as a literal list,
  which is what makes AC-DC-2's set comparison an observable quantity rather than a
  free-text extraction. The human stderr render is a projection of that payload; the
  payload is the contract.

  **Declared uniqueness check.** "Exactly one definition site" is asserted
  REPO-WIDE — a search over `packages/**` for the member-set literal (the tokens
  `"rejected"`/`"wontfix"`/`"superseded"`/`"duplicate"` co-occurring in one
  set/array construction) must return exactly one hit, so a fourth copy appearing in
  an unnamed file goes RED. An enumerated file list cannot observe that and is
  explicitly NOT the oracle.
- **M2 — the cap ceiling is the UPSTREAM's declared policy, not a compiled-in
  literal.** `OPEN_REPORT_CAP = 10` becomes the Zod default of a new
  `feedback.inbound.open_report_cap` read from the UPSTREAM corpus's own config via
  the already-injected `deps.loadUpstreamConfig` — the queue's owner sets its own
  depth. ⛔ Deliberately NOT `feedback.upstream.*`: that section is the consumer's
  "where do I file", and a spam ceiling a spammer can raise is not a ceiling.
  Resolved through ONE seam, `resolveOpenReportCap`, never re-read from the constant.
- **M3 — two non-derogatory terminal states, each requiring a pointer.**
  `lore issue resolve --state superseded --superseded-by <doc>` and `--state
  duplicate --duplicate-of <doc>` join `rejected`/`wontfix`. The pointer is REQUIRED
  and must resolve to an existing doc — without it "superseded" degrades into a
  silent trash can operationally indistinguishable from `rejected`, which is the
  defect, not the fix. Both states extend `IssueResolution`, the terminal set from
  M1, and `--resolved`'s complement, so they free quota under M1 and stay visible
  under `--resolved`.
- **M4 — every issue read surface names the corpus it read, and `lore issues`
  reaches the configured upstream by default.** When `feedback.upstream` is
  configured, `lore issues` reads THAT corpus (`--local` forces the cwd corpus);
  unconfigured, it reads cwd as today. Both `lore issues` and `lore report-issue
  --list` name the corpus each row came from. **Declared render contract:** the human
  output's FIRST line matches the fixed prefix `Corpus: ` followed by the corpus's
  absolute path; `--json` carries the same value under a top-level `corpus_path` key.
  A fixed prefix is declared so the oracle anchors on a position rather than on
  incidental substring presence anywhere in the buffer.
- **M5 — an AC whose script command changes is a NEW oracle generation, and evidence
  recorded against a prior generation is marked as such.** `AcService.setCriterion`
  stamps a monotonically increasing `oracle_generation` on the criterion whenever the
  script-mode `verify.command` changes, and `lore evidence`/`recordVerifiedEvidence`
  stamp the generation in force at record time. `computeAcCoverage`'s per-AC fact
  gains the generation split so a consumer can tell current-generation evidence from
  evidence produced by a retired oracle. ⛔ No row is deleted, edited, or hidden —
  supersession is additive metadata, matching the append-only invariant the whole
  evidence log rests on.
- **M6 — `--severity` and `--category` on `lore report-issue`, surfaced on both read
  surfaces, ORDERING ONLY.** Written into `extra.issue_report`, rendered as columns,
  present in `--json`. ⛔ They do NOT bucket, exempt, or evict quota: severity is
  self-declared by the filer, so making it change admission would put the ceiling
  under the control of the party it constrains (the same reason M2 puts the cap on
  the upstream side).

# Out of scope

- Governance-document conflict exposure (the reporter's D3.2 — "two governance docs
  disagreeing on one topic must be surfaced explicitly"). A real gap, framed by the
  reporter as a want rather than a defect in existing behaviour, and it needs a
  design pass of its own (what is a topic key, what counts as disagreement, at which
  checkpoint is it surfaced). Recorded as an ADR so it does not evaporate.
- The `review-judgment` 55-deny / 0-retry-success signal (D3.3). This is consumer
  telemetry from a corpus this repo cannot read; diagnosing it needs that corpus's
  trace rows, not a change here.
- Severity-bucketed or eviction-based quota (see M6's refusal).
- Retro-classifying the back-catalogue of already-filed reports. M1 changes what
  counts as open going forward; existing `draft`-status reports become releasable by
  the same verbs, which is the point, but nothing sweeps them automatically.

# Acceptance Criteria

Structured, machine-checkable criteria are declared via `lore ac add` — see
`lore get <this spec> --json`. Prose summary of what each oracle must be able to
observe going RED:

1. **AC-DC-1** — Ten reports filed, all ten resolved with a non-derogatory state, an
   eleventh report ACCEPTED: the exact sequence refused today (F1's step 4).
2. **AC-DC-2** — A cap refusal that quotes each blocking id together with its computed
   resolution, whose named verb SET equals the set of states producing a terminal
   resolution under M1's shared export (compared as sets, never against a remembered
   literal list).
3. **AC-DC-3** — An upstream config declaring a cap of N refuses at N+1, not at 10.
4. **AC-DC-4** — A non-derogatory state with no pointer, or an unresolvable pointer,
   refused loudly with the target's `extra` byte-identical afterwards.
5. **AC-DC-5** — `lore issues` in a consumer corpus with `feedback.upstream` configured
   returns the SAME id set `report-issue --list` returns, both naming the corpus.
6. **AC-DC-6** — The reverse control: `--local` in that same corpus returns zero rows
   and names the CONSUMER path, so the default upstream read is a real switch rather
   than both branches reading one side.
7. **AC-DC-7** — Severity/category visible on both read surfaces, and a quota filled
   with critical reports still refuses a further critical one (admission-neutral).
8. **AC-DC-8** — An AC whose script command is rewritten reports its prior-generation
   evidence as prior-generation, while every row stays byte-identical in the log.
9. **AC-DC-9** — The terminal-resolution set has exactly one definition site, named
   file-by-file, consumed by both the listing filter and the cap-count path.


# Re-baseline log

⛔ An AC edited after it has been red is indistinguishable in the audit trail from covering
up a failure, no matter how justified. So every in-flight revision is recorded here with
three things: the original text, the exact observation that prompted the change, and why it
is a correction rather than a weakening.

## AC-DC-9 — prose only, 2026-08-12

**Original clause:** "…and that single site is the `TERMINAL_ISSUE_RESOLUTIONS` export in
`packages/lore/src/service/issue-resolution.ts`, imported by both `commands/issues.ts` and
the cap-count narrowing in `issue-report-service.ts`."

**What was observed.** AC-DC-9 went RED on the merged tree (it was green in its author's
worktree — a concurrent peer merge invalidated a threshold calibrated against an older base).
`lore verify` on main at `1634db63`:

```
exactly one file may construct the terminal-resolution member set:
expected [ "packages/dashboard/src/lib/api.ts (1)",
           "packages/lore/src/service/issue-resolution.ts (1)" ]
to deeply equal [ "packages/lore/src/service/issue-resolution.ts (1)" ]
```

**What was NOT done.** The scan universe was not narrowed and the assertion was not
loosened. That would have been an AC weakened after going red, and the duplicate was real —
type-coupled rather than silent, but real. Instead the second site was ELIMINATED by
relocating the vocabulary into `@lore/core`, after which AC-DC-9 and AC-DC-12 both pass
attested with neither statement nor command modified (measured: `AC-DC-9 pass (1675ms, exit 0)`,
`AC-DC-12 pass (9589ms, exit 0)`, on the rebuilt merged tree).

**What IS being corrected, and why it is not a weakening.** The relocation moved the single
member LITERAL to `packages/core/src/issue-resolution-vocab.ts`. The clause above names the
old file, so it is now false — a stale path reference, not a loosened obligation. §M1's own
"Declared uniqueness check" block pins no path (only "exactly one hit over `packages/**`"),
so the SPEC was satisfied throughout; the drift is confined to this AC's derived sentence.
The cardinality asserted (exactly one file, exactly one site), the scan universe
(`packages/**`, tests included), and the requirement that consumers import rather than
re-declare are all unchanged. The oracle's own constant was already updated by the
relocating implementer, which is what surfaced the sentence's drift; it additionally ADDED an
assertion that the service's list is reference-identical to core's array and reached by
`import … from "@lore/core"`, so "consumed by the listing filter and the cap count" stays
machine-checked rather than merely asserted in prose.

# Addendum — M7: the missing NON-TERMINAL exit, measured 2026-08-18/21

⛔ Appended after the original slice landed. M1–M6 shipped and WORK — verified 2026-08-21:
`TERMINAL_ISSUE_RESOLUTIONS` is exported and consumed by both the listing filter and the cap
count, `resolveOpenReportCap` reads the upstream's own config, and `superseded`/`duplicate`
join `rejected`/`wontfix` as non-derogatory terminal states. The channel is still stuck, and
the reason is a state M1–M6 never contemplated.

## The measurement

`lore issues --all` in this corpus, 2026-08-21: 32 reports, of which **10 filed by the `lore`
project itself are `open`** — the cap is full and refuses every new report from this project.
Filed 2026-08-12/13, all still `draft`.

Every exit M1–M6 provides is TERMINAL and asserts something about the CLAIM:

| state | what it asserts |
|---|---|
| `rejected` / `wontfix` | the defect is not going to be fixed |
| `superseded` / `duplicate` | a different record now carries the claim |

None of them fits the actual situation of all ten: **the defect is real, accepted, and not yet
done.** The queue is therefore monotonic by construction — a report can only leave by having
its claim retired, so an accepted-but-unfinished defect occupies quota forever.

⛔ The escape was TESTED, not assumed. Two of the ten (the mirror-exporter pair,
`01KZVAXZQAT4S9F4HGQT45YTT9` and `01KZWF5EFFNWW673QYEEPNCMVT`) were re-probed on 2026-08-20
because `AC-BFI-8` had since landed a mirror CONTENT check and they might honestly be
closable. A two-line body drift was injected into a mirror file and `bun run mirror:export`
was run with no `--force`: the drift SURVIVED untouched. Both reports are still valid. Closing
one to free a slot would mark an unresolved defect resolved, and afterwards would be
indistinguishable from a real fix. **There is no honest way to free a slot today.**

## The consequence this spec must own

Because the channel refuses input, four further governance gaps measured 2026-08-18/19 were
written into `knowledge-four-governance-gaps-measured-while-resuming-handoff` instead — a
document **no `--check` reads**. So the standing "report a tool gap immediately" discipline has
degraded from enforced to advisory, and nothing announced the change. That is the same failure
shape as an armed gate that vacuously passes: the mechanism appears present and is not.

## M7 — `adopted`, a non-terminal, quota-freeing exit that REQUIRES an owner

`lore issue resolve --state adopted --adopted-by <plan-or-task>`:

- **Non-derogatory and NON-TERMINAL.** It asserts nothing about the claim's validity — only
  that the claim now has an owner in the corpus. It therefore does NOT join
  `TERMINAL_ISSUE_RESOLUTIONS`, and `--resolved` must keep showing it as unfinished.
- **Frees quota.** The cap counts reports with no owner and no terminal resolution. This is the
  one place M7 touches M1: the cap's candidate set is narrowed by `TERMINAL_ISSUE_RESOLUTIONS`
  ∪ `{adopted}`, resolved through ONE seam so "what occupies quota" has a single definition.
- **The pointer is REQUIRED and must resolve to a live `plan` or `task`.** Without it,
  `adopted` degrades into a silent trash can operationally indistinguishable from `rejected` —
  which is the defect, not the fix. Same reasoning M3 already applies to `superseded`.
- **The pointer must stay honest after the fact.** An `adopted` report whose owner was archived
  WITHOUT the defect being fixed is a dangling claim, and it must be visible as one: a
  corpus-wide count of adopted-with-terminal-owner, enumerable like every other count field
  (`AC-FR-5`'s rule — every count has a sibling that names its members). ⛔ This is the part
  that keeps `adopted` from becoming a laundering path: adopting is cheap, and the only thing
  stopping it from being a quieter `rejected` is that abandonment is COUNTED.

⛔ Explicitly NOT in M7: auto-creating the owning plan or task. An adopt verb that mints its
own owner would let a caller free quota without anyone deciding to do the work, which is the
same "a ceiling the constrained party controls" objection M2 and M6 already record.

## Addendum note — the prose criteria list above is PARTIAL, by measurement

⛔ The numbered §Acceptance Criteria summary earlier in this document enumerates `AC-DC-1`
through `AC-DC-9` only. More criteria have been declared since, by later slices and by M7.
Found 2026-08-21 by this spec's own `lore review` pass under the `completeness` dimension —
the drift was invisible to every deterministic pre-check, because prose is not an oracle.

The authoritative surface is `lore ac list <this spec>` (or `lore get <this spec> --json`).
⛔ No count is restated here on purpose: a literal corpus figure inside a governance document
is a claim with no oracle, and this repo has already measured one such figure off by 20x. Read
the list; do not read a number out of prose.

## Authoring note for M7's criteria

`AC-DC-16` and `AC-DC-17` were TIGHTENED immediately after their first `lore review`, before
either had been run and before either held any evidence. This is authoring, not a re-baseline —
recorded here anyway so the edit is visible rather than inferred from a version bump:

- `AC-DC-16` originally keyed the dangling-claim predicate on the owner going terminal
  "WITHOUT the defect being fixed". The judge correctly noted that no field records "fixed", so
  an implementer would have had to pick a reading, and the two seeded reds could not
  discriminate between the candidate readings. Replaced with three conjuncts that are all
  decidable from stored fields, plus a third red seed that isolates the one the original pair
  could not.
- `AC-DC-17` said "the freshness-asserted dist binary" without naming the threshold or the
  behaviour on failure. Replaced with an explicit pre-flight: `--check-binary-provenance` must
  exit EXACTLY 0, and a stale binary FAILS the suite rather than skipping it — a skipped wiring
  check is indistinguishable from a passing one.

Both changes narrow what a green run can mean. Neither relaxes an obligation.

## Re-baseline — AC-DC-1, 2026-08-21, caused by M7

⛔ Recorded because an AC edited after it has been green is indistinguishable in the audit
trail from covering up a failure, however justified the edit.

**Original statement (verbatim, the clause that changed):** "ALL 10 resolved with a
non-derogatory terminal state, then the 11th report is ACCEPTED (exit 0)".

**The exact observation that prompted the change:** this spec's `lore review` pass on
2026-08-21, `ac_quantifiability` advisory on AC-DC-1 — "'resolved with a non-derogatory
terminal state' leaves the state unnamed, and M3 defines two candidates (superseded,
duplicate) with different required pointers while M7 adds a third exit that is deliberately
non-terminal. An implementer picking 'adopted' here would be testing the M7 path rather than
the M1/M3 one." ⛔ There was no failing run. AC-DC-1 is green with two attested passes; the
oracle command is BYTE-UNCHANGED.

**Why this is a correction and not a weakening:** the ambiguity did not exist when AC-DC-1 was
written — M7, added earlier today in this same document, is what created a third
non-derogatory exit and thereby made an already-attested criterion's prose ambiguous for the
next reader. The edit NARROWS the admissible state set (must be a member of
`TERMINAL_ISSUE_RESOLUTIONS`, `adopted` explicitly excluded) and adds a named RED. Nothing
that satisfied the old text and exercised M1/M3 stops satisfying the new text; what stops
satisfying it is exercising M7 instead, which was never the intent.

## Known advisory NOT fixed here — AC-DC-2's render half

The same review pass flagged AC-DC-2: its stderr half says every blocking id "appears in the
human stderr render alongside its resolution", and "alongside" names no position, delimiter or
column — so an id and a resolution occurring anywhere in the buffer satisfy it even if the
render paired them wrongly. Every sibling render assertion in this spec declares an anchor
(`Corpus: ` as a first-line prefix, columns headed exactly `Severity`/`Category`, a literal
bracketed marker); this one does not.

⛔ Left unfixed deliberately, and recorded rather than dropped: it is a pre-existing defect in
a criterion with two attested passes, it was NOT introduced by M7, and tightening it belongs
with a slice that can run its red. ⛔ It is NOT in the defect channel because that channel is
at its cap and refuses input — which is the situation M7 exists to end. This paragraph is the
only record; when M7 lands, file it.


## Acceptance Criteria (structured)

- [✔] [script] AC-DC-1: End-to-end over two throwaway corpora: 10 reports filed, ALL 10 resolved with a non-derogatory TERMINAL state — one that IS a member of TERMINAL_ISSUE_RESOLUTIONS, i.e. superseded or duplicate under M3, and explicitly NOT M7's 'adopted', which frees quota by a different mechanism and is deliberately non-terminal — then the 11th report is ACCEPTED (exit 0). This is the exact sequence measured refused (exit 4, byte-identical cap message) on 2026-08-11. ⛔ The state is named rather than left to the implementer because M7 introduced a third non-derogatory exit after this criterion was written and attested; without the exclusion, an implementer could satisfy this criterion while exercising the M7 path and never touch the M1/M3 mechanism it exists to pin. RED: revert M1's candidate narrowing to raw lifecycle status and the 11th report must be refused again.
  script: test — bun test packages/lore/tests/integration/cli/issue-cap-quota-release.bun.test.ts 2>&1 && echo "AC-DC-1 PASS: a non-derogatory resolution releases cap quota end-to-end through the real CLI"
- [✔] [script] AC-DC-2: The cap refusal's structured LoreError.value payload carries blocking[] with one {id, resolution} entry per blocking report AND quota_freeing_states[]; the test asserts quota_freeing_states equals TERMINAL_ISSUE_RESOLUTIONS as SETS (never against a remembered literal list), and that every blocking id in the payload appears in the human stderr render alongside its resolution — so the refusal can never advertise a verb that does not free quota.
  script: test — bun test packages/lore/tests/integration/cli/issue-cap-refusal-message.bun.test.ts 2>&1 && echo "AC-DC-2 PASS: every blocking id in the cap refusal carries its computed resolution and only working verbs are named"
- [✔] [script] AC-DC-3: The ceiling is read from the UPSTREAM corpus's own feedback.inbound.open_report_cap: with N=3 the 3rd report is accepted and the 4th refused naming cap 3 — proving the compiled OPEN_REPORT_CAP literal is no longer the operative value.
  script: test — bun test packages/lore/tests/integration/cli/issue-cap-configurable.bun.test.ts 2>&1 && echo "AC-DC-3 PASS: the upstream corpus own config sets the ceiling, not the compiled constant"
- [✔] [script] AC-DC-4: lore issue resolve --state superseded with NO --superseded-by, and with a pointer that does not resolve to an existing doc, BOTH exit 4 and write nothing — the target task's extra is byte-identical before and after (SHA compared).
  script: test — bun test packages/lore/tests/integration/cli/issue-resolve-pointer-required.bun.test.ts 2>&1 && echo "AC-DC-4 PASS: a non-derogatory terminal state without a resolving pointer is refused and writes nothing"
- [✔] [script] AC-DC-5: In a consumer corpus with feedback.upstream configured, lore issues --all --json returns the SAME doc-id SET (set equality, not merely non-empty) as lore report-issue --list --json; both --json payloads carry a top-level corpus_path equal to the upstream corpus absolute path, and both human renders' FIRST line matches the fixed prefix 'Corpus: ' followed by that same path.
  script: test — bun test packages/lore/tests/integration/cli/issue-read-surfaces-agree.bun.test.ts 2>&1 && echo "AC-DC-5 PASS: both issue read surfaces return the same id set and each names the corpus it read"
- [✔] [script] AC-DC-6: Reverse control for AC-DC-5: lore issues --local in that SAME consumer corpus returns zero rows and names the CONSUMER corpus path — proving the source actually switches rather than both branches reading upstream.
  script: test — bun test packages/lore/tests/integration/cli/issue-read-surface-local-control.bun.test.ts 2>&1 && echo "AC-DC-6 PASS: --local reads the cwd corpus and names it, so the default upstream read is a real switch"
- [✔] [script] AC-DC-8: Rewriting a script-mode AC's verify.command bumps that criterion's oracle_generation, computeAcCoverage reports pre-bump evidence as prior-generation, and every stored evidence row is byte-identical before and after (SHA of the serialized rows compared) — supersession is additive metadata, never an edit.
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-oracle-generation.test.ts 2>&1 && echo "AC-DC-8 PASS: an oracle polarity change marks prior-generation evidence without mutating a single row"
- [✘] [script] AC-DC-9: A REPO-WIDE search over packages/** finds exactly ONE construction site of the terminal-issue-resolution member set (the rejected/wontfix/superseded/duplicate tokens co-occurring in one set or array literal) — so a fourth copy in any unnamed file goes RED — and that single site is the vocabulary in packages/core/src/issue-resolution-vocab.ts, from which packages/lore/src/service/issue-resolution.ts derives its export by import (reference-identical, machine-asserted) and which commands/issues.ts and the cap-count narrowing in issue-report-service.ts consume rather than re-declare. See the spec's Re-baseline log for why this names core rather than the service file.
  script: test — bunx vitest run packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts 2>&1 && echo "AC-DC-9 PASS: one terminal-resolution definition site, consumed by both the listing filter and the cap count"
- [✔] [script] AC-DC-7: The severity and category flags round-trip into extra.issue_report and are visible on BOTH read surfaces under ONE vocabulary. DECLARED RENDER CONTRACT, so the oracle anchors on named positions rather than incidental substring presence: the human tables of lore issues AND lore report-issue --list each carry columns headed exactly 'Severity' and 'Category', and each --json row carries the values under the keys severity and category. ⛔ One spelling across both surfaces — a test asserting only that the value appears somewhere would pass while the two surfaces drifted to two vocabularies. AND they provably change no admission decision: a quota filled entirely with severity=critical reports still refuses a further critical report. Contract declared retroactively 2026-08-12 to match what shipped (both surfaces already agreed); see the Re-baseline log.
  script: test — bun test packages/lore/tests/integration/cli/issue-severity-ordering-only.bun.test.ts 2>&1 && echo "AC-DC-7 PASS: severity/category are visible on both reads and change no admission decision"
- [✔] [script] AC-DC-10: The oracle-generation split is REACHABLE from a user-facing surface. DECLARED RENDER CONTRACT, so the oracle anchors on a token rather than incidental substring presence: lore ac list appends to a criterion's line the literal marker ' [retired_oracle_evidence: prior_refs=<N> current_refs=<M> generation=<K>]' when and only when prior_refs > 0, and the marker's keys are the AcCoverageFact field names so human and --json share one vocabulary; --json's coverage[] entries carry the same oracle_generation object serialized verbatim. The criterion's BADGE deliberately stays green (no eighth deriveAcCoverageState state), which is why the marker rather than the badge is the signal. Asserted by SPAWNING the CLI, never by calling computeAcCoverage — a unit test over the aggregator passes whether or not any renderer reads the field. Contract declared retroactively 2026-08-12 to match what shipped; see the Re-baseline log.
  script: test — bun test packages/lore/tests/integration/cli/ac-oracle-generation-surface.bun.test.ts 2>&1 && echo "AC-DC-10 PASS: a retired oracle is visible as retired on the ac read surface, not only in the aggregator"
- [✔] [script] AC-DC-11: The retired-oracle signal reaches the FEED surface. DECLARED CONTRACT: for a task whose governing AC had its script command rewritten after evidence was recorded, lore feed task-start's acceptance section carries, on that criterion's row, the SAME literal marker lore ac list uses — ' [retired_oracle_evidence: prior_refs=<N> current_refs=<M> generation=<K>]', keys being the AcCoverageFact field names — and the same oracle_generation object verbatim under that criterion in --json. ⛔ One renderer vocabulary across both surfaces, never a second spelling. The pack MUST omit the marker when prior_refs is 0, so the oracle can fail for a marker that always fires as well as for one that never does. Asserted by SPAWNING lore feed task-start, never by calling the flow in-process. ⛔ Do not extend deriveAcCoverageState to an eighth state to carry this.
  script: test — bun test packages/lore/tests/integration/cli/feed-retired-oracle-visibility.bun.test.ts 2>&1 && echo "AC-DC-11 PASS: the feed pack distinguishes retired-oracle evidence from current"
- [✔] [script] AC-DC-12: The dashboard cannot silently lag the IssueResolution union: it constructs no resolution list of its own but imports the vocabulary from @lore/core, so ADDING a member without updating the dashboard fails to compile IN THE COMPONENTS THEMSELVES (TS2322 'not assignable to type never' from each exhaustive switch), not merely in a test. Asserted by a probe that injects one additional synthetic member into the core union and observes typecheck failing inside both component files, with two controls (untouched project clean; unwidened overlay clean) so the red is isolated to the widening rather than to the overlay machinery. ⛔ A test that only checks the members present today would pass against a re-frozen hand-mirror. Corrected 2026-08-12: the original text said 'a synthetic 13th member' (the union has 8) and located the union in @lore/core before it was there — see the Re-baseline log.
  script: test — bunx vitest run packages/dashboard/tests/unit/issue-resolution-union-parity.test.ts 2>&1 && echo "AC-DC-12 PASS: the dashboard resolution vocabulary is type-tied to the core union and both switches are exhaustive"
- [✔] [script] AC-DC-13: The oracle-generation stamp reads its criteria from the INJECTED declared-AC port, and the duplicate task-to-plan-to-spec traversal is GONE rather than merely unused. ONE vitest file carries both halves. (a) BEHAVIOUR, the discriminator: injecting a declared-AC port that returns a criterion whose oracle_generation DIFFERS from what a store walk over the same task would find makes the stamp follow the PORT -- so a surviving second traversal goes RED, which a mere existence check could never detect -- and the same run asserts the ad-hoc task path reads the port too. (b) CENSUS in the same file: a search over packages/lore/src and packages/core/src finds ZERO occurrences of the identifier findGoverningAcceptanceCriteria and ZERO occurrences of the residual note that recorded the gap (the literal phrase BOUNDED second traversal) -- the note documenting a gap dies in the same change as the gap.
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-port-carries-criteria.test.ts 2>&1 && echo "AC-DC-13 PASS: the oracle-generation stamp reads criteria from the injected port and the duplicate traversal is gone from the tree"
- [·] [script] AC-DC-14: ADOPTION FREES QUOTA WITHOUT RETIRING THE CLAIM — the exact sequence that is refused today. With the cap filled by N open reports, resolving ONE with --state adopted --adopted-by <live plan or task> makes report N+1 ACCEPTED. Two controls that must hold in the SAME run, or 'adopted' has silently become a quieter 'rejected': (a) the adopted report is STILL listed as unfinished by --resolved's complement, i.e. adopted is NOT a member of TERMINAL_ISSUE_RESOLUTIONS; (b) the quota-occupancy decision is resolved through ONE seam whose member set is compared AS A SET against TERMINAL_ISSUE_RESOLUTIONS plus adopted, never against a remembered literal list. Baseline measured 2026-08-21: 10 reports filed by this project, all open, all draft, filed 2026-08-12/13, and the cap refuses every new one. Two of the ten were re-probed for staleness on 2026-08-20 rather than assumed stale, and both were still valid — so no honest closure was available. RED: make adopted terminal and control (a) must fail; drop the pointer requirement and AC-DC-15 must fail.
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-resolution.test.ts -t adopted-frees-quota 2>&1 && echo 'AC-DC-14 PASS: an adopted report frees quota, stays listed as unfinished, and occupancy is decided by one seam compared as a set'
- [·] [script] AC-DC-15: THE OWNER POINTER IS REQUIRED AND MUST RESOLVE TO A LIVE PLAN OR TASK, AND A REFUSAL WRITES NOTHING. --state adopted with no --adopted-by, with an unresolvable id, or with a target whose type is neither plan nor task is refused loudly (exit 4), and the target report's extra is BYTE-IDENTICAL afterwards. Same reasoning M3 already applies to superseded: without a required pointer, adopted degrades into a silent trash can operationally indistinguishable from rejected, which is the defect rather than the fix. ⛔ Assert the exit code is EXACTLY 4, never merely non-zero — a command that dies early for an unrelated reason also exits non-zero, and that is how a reverse control ends up with no discriminating power. RED: accept an absent pointer and the first case must fail; make the write happen before validation and the byte-identity assertion must fail.
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-resolution.test.ts -t adopted-pointer-required 2>&1 && echo 'AC-DC-15 PASS: absent, unresolvable and wrong-type owners are each refused with exit exactly 4 and the target extra unchanged'
- [·] [script] AC-DC-16: ABANDONMENT IS COUNTED, AND THE COUNT NAMES ITS MEMBERS. A dangling adopted claim is defined by STORED FIELDS ONLY, never by judgement: a report whose issue_report.resolution.state is 'adopted' AND whose adopted_by target resolves to a doc with status archived or deprecated AND which itself carries NO terminal resolution (its state is not a member of TERMINAL_ISSUE_RESOLUTIONS). All three conjuncts are decidable from the store; ⛔ 'the defect was not actually fixed' is deliberately NOT a conjunct, because no field records it and an implementer would have to guess which surface to read. lore status reports a corpus-wide count of exactly that population, with a sibling enumeration returning member ids whose length EQUALS the reported number — the rule AC-FR-5 establishes for every count field. ⛔ This is the load-bearing half of M7, not a nicety: adopting is cheap, and the only thing preventing 'adopted' from becoming a quieter 'rejected' is that abandonment is visible and attributable. RED, three seeds required, each isolating one conjunct: (a) adopted + archived owner + no terminal resolution must be counted, naming it; (b) adopted + LIVE owner must NOT appear; (c) adopted + archived owner but carrying a terminal resolution must NOT appear. Seeds (b) and (c) are what stop the count from degenerating into 'every adopted report'.
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-resolution.test.ts -t adopted-abandonment-count 2>&1 && echo 'AC-DC-16 PASS: adopted reports with terminal owners are counted, enumerated, and live-owner reports are excluded'
- [·] [script] AC-DC-17: PRODUCTION WIRING, COMPILED BINARY (the bun-runner half, split from AC-DC-14 because this repo's two runners cannot share one attestable command): from a throwaway corpus created by mkdtemp plus lore init, driven by the compiled dist binary, a real lore issue resolve --state adopted --adopted-by <live task> frees quota so the next lore report-issue is ACCEPTED, and lore issues still shows the adopted row as unfinished. BINARY FRESHNESS IS ASSERTED, NOT ASSUMED, and the threshold is named: before spawning anything the suite runs 'lore status --check-binary-provenance' via the resolved dist path and requires exit EXACTLY 0 (dev-synced, built from this repo's HEAD); a nonzero provenance verdict FAILS the suite loudly naming the built-from commit and HEAD, and ⛔ never skips — a skipped wiring check is indistinguishable from a passing one. ⛔ Resolve the binary through the same dist-path constant the sibling e2e suites already import; never a bare 'lore' on PATH, which resolves to this machine's global symlink rather than this build. ⛔ Never this repo's own .lore/ corpus. RED: revert the cap's candidate narrowing and the accept case must exit 4; point the suite at a deliberately stale binary and the provenance assertion must fail rather than skip.
  script: e2e — bun test packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts 2>&1 && echo 'AC-DC-17 PASS: the compiled CLI frees quota on adopt, accepts the next report, and still lists the adopted row as unfinished'
