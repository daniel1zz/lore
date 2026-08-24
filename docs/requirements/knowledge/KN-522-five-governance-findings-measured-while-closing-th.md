---
id: KN-522
type: knowledge
role: knowledge
title: "Five governance findings measured while closing the content-dimension plan and evicting the root CLAUDE.md — the defect channel's read and write surfaces disagree"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-095
---
## What this session did

Closed `plan-implementation-claude-md-content-dimension-checks-split` (SPEC-095 narrative
sync + fresh assess + archival) and then evicted the root `CLAUDE.md`, which had been
sitting 18 bytes from its `eviction_required` floor. Five findings below were measured on
the way; each names the mechanism that would have caught it.

## F1 — The defect channel's READ and WRITE surfaces give OPPOSITE verdicts on the same config

Measured 2026-08-24 on this repo, whose `.lore/config.yaml` carries the retired
`feedback.upstream.corpus_path` shape and no `feedback.upstream.repo`:

| Surface | Command | Exit | Behaviour |
|---|---|---|---|
| WRITE | `lore report-issue --title ... --severity high` | **4** | Refuses, names the retired shape and the remedy. Fail-loud, correct. |
| READ | `lore issues` | **0** | Prints `Corpus: /Users/apple/Projects/zz/lore` + 27 open reports. |
| READ | `lore issues --local` | **0** | **Byte-identical** to the line above (`diff` exit 0). |

`lore issues`'s own help promises it "reads the configured `feedback.upstream` corpus by
default (`--local` reads this corpus), and always names the corpus it read". Both halves
still *read* as satisfied — because the corpus it fell back to is the local one, so the
name it prints is truthful about *where it read* while being silent about the fact that
the configured upstream was ignored. The flag that distinguishes upstream from local has
become inert, and nothing in stdout says so; the only signal is a one-line stderr
deprecation that never uses the word fallback.

Worse: the 27 reports it happily enumerates are legacy SQLite-shape reports that the
WRITE path considers structurally unreachable. So the read surface presents an inventory
its own write surface has retired.

For this repo the collapse is harmless — its upstream IS itself, deliberately (see the
`feedback:` comment in `.lore/config.yaml`). For any consumer whose retired
`corpus_path` pointed at a DIFFERENT corpus, `lore issues` now reports their own local
reports while they believe they are reading upstream.

⛔ This is the governance-layer twin of the silent fallback the store-selection path
explicitly refuses (root `CLAUDE.md` -> Store selection D-007: missing credentials must
`err(VALIDATION_ERROR)`, never fall back). Same class, opposite handling, one binary.

**Mechanism needed.** The read path must share the write path's config-shape validation:
one `resolveFeedbackUpstream` that returns `Result`, consumed by BOTH verbs, so a
retired-only config produces the same exit-4 refusal on read as on write. A `--local`
flag whose presence changes nothing is the machine-checkable red flag — an oracle that
asserts `lore issues` and `lore issues --local` DIFFER under a valid non-local upstream,
and that both REFUSE under a retired-only one.

⛔ Consequence for this doc's own filing: F1 could not be filed through
`lore report-issue`, because the channel is correctly refusing. A finding about a broken
reporting channel cannot use that channel — so it lands here.

## F2 — A deleted module's name survives in source comments, structurally invisible to the new reference check

SPEC-146's three-way split deleted `packages/lore/src/service/claude-md-check.ts`
(now `claude-md-budget.ts` / `claude-md-admission.ts` / `claude-md-findings.ts`).
`git grep -c claude-md-check` over tracked non-mirror files still reports references in
16 files. Many are legitimately historical and say so ("pre-split", "former",
"Extracted from"). These are NOT:

- `packages/core/src/config.ts` — 4 occurrences, all present-tense JSDoc attributing live
  behaviour to the deleted path (lines ~1040, ~1119, ~1136, ~2048): e.g. "`computeHeadroom`
  (`packages/lore/src/service/claude-md-check.ts`) marks a metric as ...". `computeHeadroom`
  now lives in `claude-md-budget.ts`.
- `packages/lore/src/service/context-facts.ts` — 2 present-tense ("a `claude-md-check.ts`
  lint concern").
- `packages/lore/src/ai/assess-template.ts` — 1 ("the existing convention (`claude-md-check.ts`)").
- `scripts/check-claude-md-purity.ts` — 2.

The check this very plan shipped (`checkReferenceExistence`, dangling backtick-quoted
repo-relative paths) scans **memory files only**. Source comments are outside its
discovery set, so this class is invisible to it by construction — the same shape as the
root `CLAUDE.md` dangling references the plan DID catch, in a place nothing looks.

**Mechanism needed.** Point the existing reference grammar at a second discovery set
(source + test comments), or add a repo script the pre-push chain invokes. ⛔ Not prose:
this repo's own standing rule already says fixing a gap and updating the comments that
record it is ONE acceptance unit, and it did not bind here.

## F3 — A positional pointer ("Same doc.") resolved to the WRONG document

The root `CLAUDE.md` standing-lessons list ended three entries with the bare words
"Same doc." Resolved by search + content match while evicting:

| Entry | "Same doc." actually resolves to |
|---|---|
| `lore ac set` demotes an approved spec and blocks descendant claims | `knowledge-three-of-lore-s-own-outputs-misled-this-session-a` |
| A literal corpus count is a claim with no oracle (`pass_unfalsified` off 20x) | `knowledge-three-of-lore-s-own-outputs-misled-this-session-a` |
| An `assess` MAJOR can be exactly BACKWARDS | `knowledge-nine-findings-from-landing-the-mirror-id-unify-merge` |

The third was **false**: read positionally it names the preceding bullet's
`knowledge-an-attested-pass-is-not-evidence-of-production-wiring`, which contains zero
matches for "backward", "rename", or "path existence". The finding actually lives in the
mirror-id-unify retro, under its "Mechanization" heading. All three are now written as
real slugs.

`lore status --check-memory-pointers` cannot see this class: "Same doc." contains no
backtick-quoted slug, so there is nothing for the grammar to resolve. A pointer that is
merely terse is invisible; a pointer that is terse AND wrong is invisible in the same way.

**Mechanism needed.** Treat a list item under an index-like section that carries NO
resolvable pointer as a finding in its own right (advisory is enough) — absence of a
pointer is decidable, exactly like existence of one.

## F4 — The root file's lifecycle diagram omitted a transition its own source allows

Root `CLAUDE.md` -> Document Lifecycle rendered the transitions as
`draft -> in-review -> approved -> active -> archived`, `approved -> deprecated`,
`active -> archived | deprecated`. `packages/core/src/schemas.ts:801` actually declares
`approved: ["active", "archived", "deprecated"]` and `"in-review": ["approved", "draft"]`.
So `approved -> archived` is legal and direct, and `in-review -> draft` exists — neither
appeared. Measured by archiving this session's plan straight from `approved` (exit 0).

The diagram cited its own source (`schemas.ts -> VALID_TRANSITIONS`) and was still wrong,
which is the interesting part: citing the SSOT is not the same as being checked against it.
Fixed in place, including the direct edge marked explicitly.

**Mechanism needed.** A code-derived assertion: the fenced block is generated from
`VALID_TRANSITIONS`, or a test parses the block and diffs it against the constant.

## F5 — The next file to trip is already named

After this eviction, root sits at 21932/24576 bytes (2644 remaining; 1906 below its
eviction floor). The remaining advisory belongs to `packages/core/src/CLAUDE.md` at
15704/16384 — its own eviction floor is 16384 x 0.97 = 15892, i.e. **188 bytes away**.
Read the live numbers from `lore status --check-claude-md`; do not trust these once the
file is touched.
