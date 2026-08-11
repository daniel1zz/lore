---
id: ADR-028
type: adr
role: decision
title: "Lore's mechanisms validate a proxy for the property, not the property, and fail silent — three questions every new deterministic mechanism must answer"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: KN-217, type: governs}
  - {id: KN-216, type: governs}
  - {id: TASK-345, type: governs}
  - {id: TASK-338, type: governs}
  - {id: KN-186, type: governs}
  - {id: TASK-337, type: governs}
---
## Context

Seven mechanism defects were filed in one session (2026-08-01) against the evidence/assess
layer. Filed individually they read as seven unrelated bugs. Laid side by side they share one
shape, and every row below was MEASURED in that session, not reasoned about:

| the mechanism checks (FORM) | the property that matters (CONTENT) | how it was exploited, unintentionally |
|---|---|---|
| `output_tail` is non-empty | the tail is CAPTURED output | an agent hand-authored prose with real numbers embedded; passes the predicate and a runner-summary shape check |
| an evidence row exists and the claim is released | the attested work is COMMITTED | 7 rows + release recorded while `git log main..<branch>` was EMPTY |
| the AC's `-t` oracle exits 0 | the AC's STATEMENT is still true | tests retitled to keep the AC id as a substring kept the oracle green after the asserted behaviour was deleted |
| `git log --grep=<slug>` returned a set | the set is this plan's work | conventionally-worded commits carry no slug; returned EMPTY, silently |
| the red-first floor is armed | red-first was actually followed | the floor only evaluates when `extra.red_first` is set by an explicit opt-in call nobody prompts for |
| the suppressed dimension was removed from `dimension_scores` | the finding is no longer PUBLISHED | the same finding still shipped via `typed_gaps` and the legacy `gaps` projection |
| a spec declares an AC | the AC's premise is reachable in production | `truncateSection` measures `task.content` alone, so an AC asserting evidence projection changes `truncated[]` could never hold — and its test passed by measuring something production never computes |

Two properties recur in every row:

1. **The check is a PROXY for the property, never the property.** The proxy is satisfiable
   without the property, usually by accident rather than by intent.
2. **The failure is SILENT.** A missing precondition yields empty-set / pass / no-op, which is
   indistinguishable downstream from "checked and fine".

## Decision

**This is inherent to Lore's ambition, not incidental, and it is therefore a standing review
lens rather than a bug class to be finished off.** Lore exists to mechanize epistemic
discipline — "did you really verify this?" — and no mechanism can check that directly. It can
only check an observable proxy. So every mechanism Lore adds carries a proxy gap by
construction, and the engineering question is never "is there a gap" but "is this gap named,
bounded, and loud".

Every new or changed deterministic mechanism (gate predicate, oracle, hook, floor, schema
refusal, detector) MUST answer three questions IN ITS OWN DOC OR JSDOC before it counts as
built:

1. **Proxy** — does this check the property, or a proxy for it? If a proxy: name one concrete
   input that SATISFIES the proxy while VIOLATING the property, and state whether that is
   accepted. "None exists" is a claim requiring the same evidence tier as any other.
2. **Silence** — what does this do when its precondition is absent or unreachable? If the
   answer is "returns empty", "passes", or "no-ops", that is a silent failure: make it loud
   (refuse, or emit an explicit not-measured marker that downstream consumers must handle).
   An empty result and a clean result must not be the same value.
3. **Opt-in** — does it bind everyone in scope, or only those who opt in? An opt-in floor
   constrains exactly the population that did not need constraining.

## Consequences

- The three questions are cheap to ask and were, in retrospect, sufficient to predict five of
  the seven defects above at authoring time.
- This ADR does NOT argue for fewer mechanisms. The opposite: nearly every defect in the table
  was FOUND by Lore's own instrumentation — the assess judge caught the unreachable-premise AC,
  `--check-drift` caught two false code anchors, the `spec-create` and `task-create` gates each
  correctly refused a write, the coverage floor surfaced its own arming defect, and the
  non-empty-tail guard caught a real tail-less row in a concurrent session's tests within
  minutes of landing. A tool that surfaces no such findings is more likely under-instrumented
  than healthy.
- **Dogfooding makes authorship and mechanism defects bleed together.** An under-specified AC
  becomes a mechanism defect one merge later: a concept-level AC ("removed from the dimension
  findings") was faithfully implemented against the narrowest legal reading, all its ACs passed
  attested, and the motivating defect survived. Question 1 applies to AC authoring, not only to
  code: an AC that names a concept rather than the fields is itself a proxy.
- Question 2 has a corollary for consumers: any field that can mean "not measured" needs a
  distinct value for it. `diff_available=false` propagating into an absence-scored judge
  dimension is the fully-worked example — it produced a published false `major` finding.

## Alternatives considered

- **Treat the seven as unrelated bugs and fix them.** Rejected: they were filed independently
  and only the side-by-side reading exposed the shape. Point fixes leave the next mechanism to
  reproduce it, which is what the standing-lesson layer exists to prevent.
- **Add a hook that enforces the three questions.** Rejected for now under the established rule
  that a twice-recommended mechanization triggers a VERIFICATION pass first: the questions are
  authoring-time and prose-shaped, and CLAUDE.md's own standing rule is that static discipline
  belongs in the discipline layer, never in a hook. Revisit if instances keep recurring after
  this ADR ships.
