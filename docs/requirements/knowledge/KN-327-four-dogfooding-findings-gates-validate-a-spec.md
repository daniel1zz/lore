---
id: KN-327
type: knowledge
role: knowledge
title: "Four dogfooding findings: gates validate a spec against itself not the spec it claims to extend; ACs are immovable once evidenced; test:changed default base is wrong on feature branches; git log alone misses a stranded task"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PRD-001
links:
  - {id: SPEC-110, type: informs}
  - {id: SPEC-080, type: relates-to}
  - {id: PLAN-101, type: informs}
---
## Context

While building `spec-context-provenance-injected-corpus-global-state-and-a` (session-start injection must declare its own scope), EIGHT mechanism-level findings surfaced that are independent of that feature. They are about how a spec can be internally well-formed, pass every gate and repeated AI review, and still be wrong; which backstops actually caught it; and where the closing gates then fought the evidence discipline that produced the fix.

## 1. Gates and the review judge validate a spec against ITSELF, never against the specs it claims to extend

The spec declared, twice, that it "extends the SPEC-080 projection contract, never duplicating it". It then contradicted an already-approved spec THREE separate times. Each contradiction was authored, gated, reviewed, approved — and caught only by an implementer running scoped tests.

| # | Rule authored into the spec | Contradicted | Caught by |
|---|---|---|---|
| 1 | D1 degenerate short-circuit: discard every data field when the budget cannot fit the scope declaration | SPEC-080 char-budget rule — "both arrays empty and still over → `budget_exceeded: true`, payload returned **intact**" | SPEC-080's own BOUNDARY unit test going red in the implementer's `test:changed` |
| 2 | D4 "the rule text names each member of `BOOTSTRAP_INJECTION_KNOWN_KEYS`" | `spec-session-start-handoff-neutrality-injection-drops-resume` — enforces ZERO literal occurrences of `resume_hint` in that exact file | The implementer, who found the two requirements mutually exclusive and could satisfy neither fully |
| 3 | D2 "prints the framing line together with the payload" (on `--injection` stdout) | SPEC-080 AC-080-3 — `--injection` "returns compact JSON whose key order matches the literal contract list" | The implementer, who followed it correctly and was forced to rewrite SPEC-080's own e2e assertions to compensate |

What did NOT catch any of the three:

- **`spec-create` gate** — legal parent, `spec_kind`, skeleton headings. Structural only.
- **`spec-promote` gate** — ≥1 structured AC. Counting only.
- **Repeated `lore review` rounds** — every round returned `approve`. On the first defect the judge's `contract` dimension explicitly reported the interaction with SPEC-080 as sound, quoting the spec's own claim of extension. It read the claim; it never opened SPEC-080. Its advisories were exclusively about AC quantifiability *inside* the spec under review.

**Root cause.** No gate and no review dimension dereferences an outbound claim of the form "extends / conforms to / does not touch <other spec>". The claim is graded as a statement about this document, not as a checkable relation between two documents. A spec that *says* it extends X is scored on saying it coherently.

**Mechanization.** When a spec's content names another spec as extended/governed, the promote gate can require a declared link and feed the named spec's contract section into the judge's context, so the `contract` dimension is evaluated against the upstream TEXT rather than the claim about it. Cheaper partial mechanization: an AC that runs the named upstream spec's own test selection before this spec may be promoted — that is what caught defect 1, three review rounds late, by accident.

**Standing lesson.** An AI judge reporting a cross-document dimension as sound has, absent the other document in its context, graded only the sentence asserting soundness. Cross-spec conformance needs the upstream text in context, or an oracle over the upstream's own tests — not a dimension name that implies it was checked. Corollary for spec authors: writing "extends X, never duplicating" is not a design decision, it is an unverified claim, and it reads as reassurance in exactly the place scrutiny is needed.

## 2. A wrong AC becomes immovable the moment evidence references it

Correcting the spec required rewriting three ACs whose statements pinned now-retired behaviour. Each time, `lore ac rm` refused:

```
Cannot remove "AC-CP-2" — task "..." has evidence referencing it.
Pass --force to remove anyway (existing evidence keeps its ac_ref and becomes dangling).
```

The refusal is correct — evidence is append-only, and an AC's identity is what evidence attests to. But both exits are lossy:

- **`--force`** → the evidence keeps a dangling `ac_ref`. `lore ac list` reports it explicitly (`Dangling ac_ref (evidence references ids no longer declared): AC-CP-5`), so the breakage is at least LOUD.
- **`--force` + re-`add` under the SAME id** → the ref resolves again, but to a DIFFERENT statement. The audit trail reads "AC-CP-2: pass" while the AC-CP-2 that was actually measured no longer exists anywhere. Strictly worse than dangling, because it looks intact.

Both were used in this session: same-id reuse once (AC-CP-2, before this lesson was drawn), then new ids for the next two (AC-CP-5→AC-CP-9, AC-CP-3→AC-CP-10). The same-id reuse is the one to regret.

**Root cause.** ACs are versioned only as a side effect of their parent doc's history and carry no per-criterion lifecycle. Docs have `invalidate --superseded-by --reason`; criteria have `add` and `rm`.

**Mechanization.** ACs need a supersede path: retire with a reason and a pointer to the replacement, keep the retired text visible so old evidence resolves to exactly what it attested, and exclude retired criteria from `lore verify`.

**Standing lesson.** Re-using an identifier to repair a broken reference converts a visible dangling pointer into an invisible wrong one. Prefer the loud breakage.

## 3. `bun run test:changed`'s default base is wrong for every worktree agent in a feature-branch repo

Its documented default base is `merge-base main HEAD`. In this repo `main` sits 28+ commits behind the live integration branch, so that base selects nearly the whole suite (~130 files) instead of the agent's actual diff.

Measured consequence: one implementer derived the base from `main`, the run legitimately exceeded the tool timeout, got backgrounded, and its turn ended with **zero evidence recorded** — the work was committed but the task stayed `draft`. A sibling agent independently judged the default wrong and substituted a narrow base, and was right. The tool made the careful agent guess and punished the literal one.

**Root cause.** A hard-coded `main` assumption in a repo whose integration branch is not `main`. The default encodes a workflow the repo does not use.

**Mechanization.** Derive the default from the current branch's upstream/integration point rather than the literal `main`, or fail loud when the computed range exceeds a sane file count instead of silently selecting everything. Until then, dispatch bundles MUST pass an explicit base SHA rather than the word "merge-base" — leaving it to the agent produced one correct and one stranded run from identical instructions.

## 4. `git log` is an insufficient pre-merge backstop — the corpus side is where a stranded task shows

The known guard gap (a live background child at hook-fire time slips past the subagent-stop commit guard) has "verify `git log` on the branch before merge" as its documented backstop. That backstop did not detect finding 3's stranded run: the commit was present and well-formed on the branch. Nothing in git distinguishes "committed and finished" from "committed, zero evidence, never released".

What did detect it: `lore ready <plan> --json` showing the task at `status: draft, ev: 0` with no active claim.

**Standing lesson.** Pre-merge verification is two checks, not one: git for "did the work land", corpus for "did the task complete". A task with commits and no evidence is invisible to the first and obvious to the second.

## 5. Review-rejection precedence caught a self-contradicting spec that a later approve would have let through

Measured on doc version 50 of the same spec, in this order: `reject` (0.72), then `approve` (0.78) — same version, no edit between them. The `reject` was CORRECT: its `consistency` finding named a Scope bullet still saying `lore bootstrap --injection` "emits the framing/boundary line itself" (with the wrong filename) while D2 and AC-CP-10 had been rewritten to route that through the governance verb and to pin `--injection` stdout as bare JSON. The later `approve` did not see that contradiction at all.

`lore approve` refused, citing the need for a non-rejecting judgment on the CURRENT version. That is rejection-precedence working exactly as designed: it blocked the "re-run review until it comes back approve" loop — which is precisely what was happening — and forced a content fix plus a new version.

Two things this measures:

- **The judge is non-deterministic on borderline docs.** Same bytes, opposite verdicts, 0.72 vs 0.78 confidence. Any workflow that treats one judge run as authoritative is sampling, not verifying. Rejection precedence converts that sampling into a ratchet, which is the right shape: a single reject is a real finding, a single approve is not a real clearance.
- **The judge's `consistency` dimension works INSIDE one document and its `contract` dimension fails ACROSS documents.** Same judge, same run: it caught two intra-document contradictions immediately (escalate on v49, reject on v50, both about a stale Scope bullet), while missing three cross-spec contradictions entirely (§1). The difference is whether the other text is in its context.

**Standing lesson.** A reject is worth more than an approve from the same judge. Never re-run a review hoping for a better verdict; fix the content and bump the version — and be grateful when the tool refuses to let you do otherwise.

## 6. A long spec is silently truncated before the judge sees it, and the verdict still reads as whole-document

The v50 `approve` disclosed its own limit in a `coverage-limits` dimension: the body was truncated mid-D3, so D3's second obligation and all of D4-D6 were never visible; it stated its approval covered "the visible material plus the passing pre-checks". The verdict is still recorded as one `approve` on the whole document.

This is a plausible partial explanation for §1: two of the three cross-spec contradictions lived in D4 and D5, in the region the judge could not see. A spec that grows through revision rounds becomes progressively less reviewed while its review record looks unchanged.

**Mechanization.** Either chunk the document and review each part with its own verdict, or refuse to emit a whole-document verdict when truncation fired (degrade to `escalate` naming the unseen sections). A disclosure buried in one dimension of a passing verdict is not a signal any downstream gate reads.

## 7. The plan-close attestation floor conflicts with rich development-time evidence

`plan-close` requires a plan-wide attested-evidence ratio ≥ 0.5. This plan reached 0.36 with every AC attested and a full clean-tree integration run recorded, because the denominator carries 35 self-reported entries that worktree agents wrote while developing red-to-green — exactly the detailed evidence trail the workflow asks them to produce.

The floor assumes evidence is predominantly terminal verification. In practice a disciplined implementer produces many more development-time records than terminal ones, so **the more honestly an agent documents its process, the further the plan drifts from closable**. Reaching 0.5 from 0.36 here needs ~14 more attested runs of commands already proven green — re-running an oracle to move a ratio is gaming the metric, not verifying anything.

**Mechanization options.** Count DISTINCT ACs attested rather than raw entry ratio (this plan: 7/7); or weight terminal-vs-development evidence separately; or exempt entries recorded before the task reached terminal state from the denominator. The current shape creates an incentive against the very evidence discipline the rest of the workflow enforces.

## 8. `lore verify` and `lore assess` are order-coupled at plan close

Every `lore verify` appends evidence, which marks the stored assessment stale, which `plan-close` then blocks on. So assess must run strictly after the last verify. If closing a plan requires additional verify runs to satisfy the attestation floor (§7), each round re-stales the assessment — a loop that only terminates if the floor is reachable. Worth an explicit "verify, then assess, then close" ordering note wherever plan-close is documented.

## Scope note

None of the eight findings is about the context-provenance feature itself. All were found by dogfooding it: three cross-spec contradictions by implementers' scoped test runs (§1), one by trying to repair the spec afterwards (§2), two by tooling behaviour during dispatch and merge (§3, §4), and two by the closing gates (§5-§8). The feature itself shipped with all seven live ACs attested green on a clean tree at commit 17c1a44.
