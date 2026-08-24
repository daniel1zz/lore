---
id: KN-542
type: knowledge
role: knowledge
title: "A --dry-run flag that does not exist writes the files anyway, a mirror CLI with no per-doc --force, and the five-pass gradient from a green-on-arrival oracle to a positive one"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PRD-001
---
## F1 — `export-spec-mirror.ts` SILENTLY IGNORES `--dry-run` and performs the write

`bun run mirror:export -- --dry-run` writes files. Measured 2026-08-24: the invocation
reported `created 1 (adr), created 2 (plan), created 4 (task)` and I read those as a
projection. `git status` afterwards showed 8 new mirror files on disk, a modified
`.lore/export-index.json` (+36 lines, 9 new id rows), and an `identity_repaired` edit to a
knowledge mirror that belonged to no one in this session.

Mechanism root, read in source: `main()` at `scripts/export-spec-mirror.ts:425` parses
`argv.includes("--check")` and NOTHING ELSE. Every other flag — `--dry-run`, `--force`,
anything — falls through to `runExport`, which writes. ⛔ This is the "no silent fallback"
rule failing in the one direction that matters: a flag whose NAME promises read-only must
fail loud on non-recognition, because the caller's whole reason for typing it is to avoid the
write. An unknown-flag guard (`exit 2` naming the flag) is the fix; a doc comment is not.

⛔ The blast radius is not one session. `knowledge-handoff-agent-main-orchestrator-123`'s NS7
("PRD-001 is a drifted mirror, deliberately not forced ... `lore export-docs --dry-run` keeps
reporting it") was itself produced by this same invocation. So the PREVIOUS session also
believed it had run a read-only check, and also wrote. Two consecutive sessions were misled
identically by a flag that does not exist.

## F2 — ⛔ RETRACTED SAME DAY. Measured wrong, generalised from the wrong surface.

**What this section originally claimed**: that the export CLI wires no `--force`, so a mirror
you legitimately drifted cannot be repaired, with SPEC-148 (corpus v35, mirror at v10) as the
live unfixable instance.

**That is FALSE.** There are TWO surfaces over `docs/requirements/`, and I measured one and
wrote about "the CLI":

| Surface | `--dry-run` | `--force` | `--type` |
|---|---|---|---|
| `lore export-docs` (the binary subcommand SPEC-021 actually specifies) | honoured | present | present |
| `scripts/export-spec-mirror.ts` via `bun run mirror:export` (repo script) | SILENTLY IGNORED, writes | absent | absent |

Measured 2026-08-24 by falsification, not by reading: `./dist/lore export-docs --dry-run`
against the live corpus left the md5 of every file under `docs/requirements/` byte-identical,
left `git status` unchanged, and self-reported `(dry-run: no files written)` /
`Corpus docs scanned: 1696` / `1696 files already match corpus (clean)`. So the flag works,
`--force` exists, and SPEC-148's mirror was repairable the whole time — it has since been
repaired and the mirror now reports ZERO drift.

⛔ **Why the error is worth more than the fact.** SPEC-021's own Goals section LISTS
`--dry-run`, `--force` and `--type` as shipped flags. I had the governing spec one `lore get`
away and did not read it before generalising from one file's `argv.includes("--check")` to a
claim about "the CLI". Reading the spec first is the cheap step that would have caught it.
This is the "investigate before judging" rule failing at small scale, and it landed in an
approved knowledge doc, where a reader has no second source to catch it with.

## F2b — what actually survives, and it is a KNOWN pattern in this repo

F1 stands and gets STRONGER, not weaker. The defect is not "an undocumented flag was
ignored". It is: **two surfaces write the same mirror directory, one honours `--dry-run` and
even announces that it wrote nothing, the neighbour silently writes.** A guard present on one
surface and absent on its neighbour reads as "guarded" everywhere — which is verbatim the
standing lesson this repo already carries for `lore issues` vs `report-issue`
(`spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired`). Same structural shape,
a different pair, found independently. ⛔ That the pattern recurred while its lesson was
already written in the root memory file is the finding: the lesson is prose, and prose does
not refuse anything.

Mechanism fix, distribution-aware: the repo script needs an unknown-flag guard (exit 2 naming
the flag). ⛔ It is a REPO SCRIPT, so a fix there ships to nobody but this repo — the binary
side is already correct, so there is no consumer-facing half to this one. Stated because
"name the delivery surface" is a standing rule and the honest answer here is "repo-local".

## F3 — five `lore review` passes on one spec, each finding something real

SPEC-148's ACs went through five review/approve cycles. Each pass found a genuine defect, and
the sequence is the interesting part because it is a gradient, not noise:

1. A negative assertion with no green control (`status unchanged` with nothing proving the
   status reader worked).
2. A semantic predicate dressed as a pinned one (`EXACTLY 0 files` over "assertions that phase
   writes do not log" — no match rule, so the count differs per implementer).
3. ⛔ **An oracle that MATCHED THE FALSE TEXT it existed to delete.** The candidate regex
   `` phase add\|rm`[^.]*logs a version `` was measured returning 1 against the very line
   ("neither demotes NOR logs a version") the conjunct exists to remove. It would have shipped
   as green-on-arrival with zero discriminating power.
4. An attribution predicate with no oracle — fixed by folding the writer names INSIDE the
   required literal, so there is nothing left to judge.
5. The choice between DISCLOSING an unclosable hole and CLOSING it.

⛔ The transferable lesson is (5), and it inverts what looked like diligence: a
**negative-only** oracle over prose ("these phrases must not appear") tends toward
paraphrase-whack-a-mole, and no number of added banned strings closes it. The exit is a
**POSITIVE** requirement pointing at the new SSOT — here, "each header must cite the ADR slug
exactly once". Fixed-string checkable, and a header compelled to cite the ADR cannot quietly
keep asserting what the ADR overturned. I had written the honest-disclosure version first;
the review judge proposed the positive form, and it is strictly better.

⛔ Second lesson: the 2000-character cap on an AC statement is a real design constraint, not
an annoyance. Four of my edits were REFUSED by it, and each refusal was correct — the
material I was trying to add was narrative, and narrative belongs in the spec body where it
has no cap. The cap enforces the split between "what is asserted" and "why".

## F4 — `active_sessions: []` does not mean no concurrent session

`lore bootstrap`'s `active_sessions` was `[]`. Forty-seven seconds later a peer session merged
a branch into `main`. It went on to merge three more times during this session, push
`origin/main` (63 ahead → 2 ahead), hold four worktrees, and leave `CLAUDE.md` modified in the
shared working tree. The field tracks lore claim leases; a session that has released its
claims but still holds worktrees and is writing `main` is invisible to it.

⛔ This one is ALREADY OWNED — do not open a second spec for it.
`spec-lore-release-erases-all-three-ownership-signals-at-once` (created by that same peer
session, 2026-08-24) is about exactly this bucket. Recorded here only because a reader of THIS
retro will reach the same wrong conclusion from the same field.

⛔ Operational consequence, measured: I removed one merged worktree while a peer was mid-merge
and it was safe ONLY because I had independently verified that branch was fully contained in
`main`. Had I trusted `active_sessions: []` as "nobody else is here" and swept the other three
worktrees, one of them (`agent-a04ebe7bd1e9ab9d9`, locked, unmerged) would have destroyed live
work. ⛔ The merge-protocol rule "never delete an unmerged worktree" is the thing that held,
not the ownership field.

## F5 — a mirrored doc containing an MDX placeholder can never stay clean, so `check:spec-mirror` is permanently red

`prd-lore-internal-first-ai-team-knowledge-platform`'s corpus body contains `<ChildrenOf />`
(15,311 bytes). Its mirror file contains that placeholder's EXPANSION — 93,088 bytes, ~587
lines of child-doc titles. `OutlineService` resolves placeholders at read time, and the
exporter writes the resolved projection, so the mirror encodes a snapshot of the corpus's
child set at export time.

⛔ Consequence, and it is structural rather than an oversight: **adding ANY doc anywhere in
the corpus re-drifts that one mirror file.** Measured inside a single session — a peer session
force-exported PRD-001 clean (`1696 files already match corpus (clean)`, drift 0, verified by
md5 over the whole mirror tree); within minutes it was drifted again because they and I had
each created new documents. `--force` is a treadmill here, not a repair.

The handoff that opened this session recorded PRD-001 as "a drifted mirror, deliberately not
forced". That reading was right about the action and wrong about the cause: it is not an
un-synced file, it is a file whose clean state has a lifetime measured in minutes under
concurrency.

**Severity, measured rather than assumed**: `hooks/pre-push` runs six checks
(`--check-binary-provenance`, `--check-tree --check-drift`, `lore audit --verify`,
`--check-prd-budget`, `--check-claude-md`, `check-anchor-coverage.ts`) and the mirror check is
NOT among them. So this does not block a push. ⛔ The real cost is different and worse in one
respect: `bun run check:spec-mirror` is a named script the root CLAUDE.md tells readers to
run, and it is now permanently non-zero. A check that can never be green carries no signal —
it can no longer tell anyone that some OTHER mirror file was hand-edited, which is the thing
it exists to detect. And its own remedy text ("This file was either hand-edited, or (for docs
with MDX placeholders) it is a stale projection") names both causes without deciding between
them, so the output cannot be triaged either.

⛔ Candidate directions, none implemented, none measured for cost — recorded so the next
session does not have to re-derive them: (1) export the UNRESOLVED body for docs whose content
contains a whitelisted placeholder, making the mirror stable and round-trip-exact, which is
what `lore sync-docs` round-trip parity would want anyway; (2) exclude placeholder-bearing
docs from the content-drift verdict and say so in the output; (3) keep expanding but classify
the verdict, so `stale_projection` and `hand_edited` are different exit states. (1) looks
right and is the only one that also fixes round-trip idempotency, but it is a guess until
someone reads `mirror-roundtrip-idempotency.bun.test.ts` and `spec-mirror-content-drift.test.ts`.

## Two self-corrections from this session, recorded because the pattern matters more than either fact

1. **F2 above was an overclaim**, generalising from `scripts/export-spec-mirror.ts`'s argv
   parsing to a statement about "the CLI", when the binary subcommand SPEC-021 actually
   specifies implements all three flags correctly. The governing spec listed them; I had not
   read it.
2. **"NS7 is fully resolved" was an inference, not a measurement.** The drift count really was
   0 at the moment I measured it, so the reading was accurate; the CONCLUSION drawn from it —
   that the item was closed — was wrong, because the quantity is not stable. ⛔ A green
   reading of a value that re-reddens on its own is not a closed item, and nothing in the
   output says which kind of value you are looking at.

⛔ Both errors share one shape: a correct local observation promoted to a general claim without
checking what governs it. Neither was caught by re-reading; both were caught by taking one more
measurement.

## F6 — `lore get` is NOT write-free, and `lore list` is

Measured by bracketing, with a negative control: `lore trace stats`' `get` counter read
10856, one `lore get <slug>` took it to 10857, and a following `lore list --type adr` left it
at 10857. So the read verb writes a trace row and the list verb does not.

⛔ Consequence for any test that reads the LIVE corpus: every full-suite run inflates
`trace_events` and launders the docs it touched out of any "never-read" or "cold doc" signal
derived from those counters. The phase-1 agent hit this and restricted its live reads to an
`audit` + `list` allowlist enforced in code, with a test asserting the refusal. That is the
right shape, but it is a workaround for a verb whose name promises a read.

## F7 — `lore done` has TWO floors, and together they make a red-first task UN-ARCHIVABLE

Measured on `task-author-the-red-first-phase-write-lifecycle-doc-parity-suite`, whose
deliberate deliverable is a FAILING oracle:

1. First refusal: no `result:"pass"` row carrying `attestation`. The message is precise and
   even diagnoses the design — a task with EMPTY `ac_scope` can reach neither `lore verify`
   (which needs a non-empty scope to resolve a governing spec) nor a plan-level verify, so
   `--override-attestation` is "the only available route".
2. Second refusal, AFTER supplying `--override-attestation` with a full reason: the task
   declares a test-file anchor, so `lore done` additionally requires an **unfiltered**
   `oracle:test result:pass` run of that file. ⛔ `--override-attestation` does NOT cover this
   floor, and no override is offered for it.

⛔ So "red-first as its own task, with the suite as its anchor" implies a **deferred archive**:
the task cannot be closed until a LATER task turns its oracle green. That is not a defect —
archiving a task whose own anchored suite is red would make the corpus claim completion over a
failing oracle — but it is an unadvertised consequence of the pattern, and the first refusal's
message actively points at an escape that the second refusal then rejects. A caller who stops
reading after refusal 1 will believe the override is sufficient.

⛔ Recorded per the standing rule that reaching for an escape hatch is itself the signal: I
did reach for `--override-attestation`, and the correct answer turned out to be to reach for
nothing and archive later.

## F8 — AC-PHASEVER-3(d) as I wrote it is SELF-COLLIDING. My AC bug, found by the implementer.

The criterion pins `grep -rIl -e 'no version history' -e 'version-less' packages/` == 0 files,
with no exclusion. The suite that IMPLEMENTS the criterion lives under `packages/` and must
reference both phrases to test for them. Spelled out: the criterion can never reach 0 whatever
the implementation does.

The phase-1 agent resolved it at source level — both phrases assembled by concatenation so
they never appear contiguously, plus a self-guard test that fails loud if anyone rejoins the
literals. Verified: the suite file greps to 0 and the tree-wide grep still returns exactly the
two service files.

⛔ That workaround is correct and it is also fragile in a way the AC does not admit: the
criterion's reachability now depends on a test file avoiding contiguous string literals. The
honest fix is an explicit exclusion in the criterion itself, so the intent is legible instead
of encoded in someone's cleverness. ⛔ NOT applied yet, and the reason is itself a finding:
`lore ac set` demotes the spec to draft and hard-blocks EVERY descendant claim, and the phase-2
implementer is working under that spec right now. A governance tool whose smallest edit has
repo-wide claim blast radius cannot be used for in-flight corrections.

## F9 — my own AC states a measured count that is an UNDERCOUNT

AC-PHASEVER-3(c) says the `resolveStatusAfterContractEdit` control in `ac-service.ts` is
"2 (import :99, call :615)". Re-measured: it is **4** — `:73` and `:1132` are prose mentions in
comments that I never counted because I looked only for code sites. The assertion is `>= 1`, so
no oracle is affected and nothing is falsified operationally.

⛔ It is still a false number inside an approved acceptance criterion, which is the category
this project ranks above code correctness. Pending correction, deferred for the same
claim-blast-radius reason as F8. ⛔ The generalisable error: I reported a grep count after
mentally filtering it to the hits I considered relevant, then wrote the filtered number as the
measurement. A count is only reproducible if the command that produced it is the whole rule.

## F10 — no CLI surface exposes link DIRECTION, and the comment that says otherwise is a false label

`corpus-service.ts` builds `navigation.related` from `this.store.findLinks(doc.id, "both")`,
directly under a comment reading "Related — non-parent **outbound** links". Read in source:
the comment says outbound, the call says both. So `lore get`'s Related block lists inbound
edges indistinguishably from outbound ones.

⛔ This bit my own AC-PHASEVER-2(b), which asserts "a direct `relates-to` edge **outbound**
from this spec". No CLI surface can confirm that. The only decidable source is the audit trail:
`action: "link"` rows are written on the FROM doc with `details.to_id`. The phase-1 agent used
it, and additionally asserted no later `unlink` row, no `parent`-typed row, and
`entries.length === total` so a truncated scan cannot read as "absent" — that last guard is the
one worth copying.
