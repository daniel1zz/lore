---
id: SPEC-176
type: spec
role: spec
title: "A spec carries its rule changes; the baseline takes them only when the spec lands"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-17
tags: []
links:
  - {id: TASK-953, type: resolves}
---
# A spec carries its rule changes; the baseline takes them only when the spec lands

**Goal**: the baseline stays a snapshot of the product as built. A rule a spec is about to introduce, rewrite or remove lives in that spec's change set — not in the tree — until the spec lands; a criterion may cite a rule its own spec proposes; landing applies the change set to the tree. User decisions 2026-10-12: "baseline永远是快照啊，为什么会有live、deprecated、retired？" and "开始" on this model (issue #183).

**Why (measured 2026-10-12)**: the citation gate refuses a criterion that cites no LIVE rule (BR-86, BR-257) and a spec cannot be approved without one, so batched governance writes a feature's rules into the tree before any code exists. Every such leaf then fails review — "a rule cannot be both live and not implemented" — five times on four leaves in one session (`baseline-remove-a-seat` v113–v121, `baseline-link-two-documents` v104–v108, `baseline-resolve-a-defect-report` v154–v159), each escalation an outstanding human decision blocking approval. The tree also went false: BR-961 still says "no git activity in the last 30 minutes" while the code that lands with `spec-one-worktree-removal-test-for-the-guard-lore-done-and-a` has no window, and that spec added BR-1079 beside BR-961/BR-962 instead of changing them. The `deprecated` lifecycle (7 rules) is used as "planned": BR-95 reads "In the target model a gate refuses … In this slice that gate does not exist". A snapshot has no such state: a rule either describes the product or it does not.

**Baseline**: modifies `baseline-cite-a-baseline-rule` BR-86, BR-257; `baseline-write-a-business-rule` BR-626; `baseline-retire-a-business-rule` BR-641, BR-643. This spec is the last one written the old way: its criteria cite only those existing rules; its own change set (below) is applied when it lands.

## Model

- **Rule ids** stay permanent (`rule_registry`, BR-625): a citation from a locked record must keep resolving. An id is in one of three registry states: `proposed` (reserved by a spec's change set, NOT in the tree), `live` (in the tree), `retired` (a tombstone: no longer true, kept so citations resolve).
- **The tree** (`extra.rules` of leaves) holds only `live` rules — the current product. Retired rules stay readable by id (BR-643) but are not part of the snapshot views (leaf body, `lore rule find`, impact, coverage) except where a view explicitly asks for tombstones.
- **A change set** on a spec: `extra.rule_changes[]`, each `{ op: "add", id, leaf, statement, examples, enforced_by }` | `{ op: "modify", id, statement?, examples?, enforced_by? }` | `{ op: "retire", id, note }`. `add` reserves a new id (`proposed`); `modify`/`retire` name a live id.

## Scope

- `lore rule propose <spec> add|modify|retire …` (writes the change set; `add` reserves an id), `lore rule changes <spec> [--json]`, `lore rule apply <spec>`.
- Citation gate: a criterion may cite a `live` rule OR an id proposed/modified by its OWN spec's change set.
- Landing: `lore rule apply <spec>` applies the change set iff every `add` and `modify` id is cited by at least one criterion of this spec AND every criterion citing a changed id has a runner-attested pass (a `retire` needs no evidence: it records that a behaviour is gone); plan close of a plan implementing the spec runs the apply and is refused while it would fail (naming the criteria without a pass). Applying writes each leaf once (one version per leaf naming the spec), turns `proposed` ids `live`, rewrites modified statements, retires retired ids with their note.
- A spec deprecated or superseded before landing: its `proposed` ids become `retired` with note "never landed: <spec>".
- `deprecated` lifecycle: no new transition into it (`rule set --lifecycle deprecated` refused, naming retire or a change set); the 7 existing deprecated rules are migrated (see Migration).
- `lore rule show <id>` for a proposed id: "proposed by <spec>, not in the baseline", plus the proposed text.
- Locked specs: the change set is part of the spec's contract — writing it on a locked spec is refused like a criterion write, with the same `--correction` exit (BR-1069).

## Out of scope

- Confidence values (established/observed/undecided/unconfirmed) — unchanged here; the computed verification state (BR-665) already answers "proven?".
- Architecture standard (AS-n) rules — same mechanism later; this slice is business rules.

## Design Decisions

- **D1 — ids are a registry, content is a snapshot.** Separating the two is what lets a locked record cite an id whose content changed or left the tree.
- **D2 — landing is evidence-gated, not status-gated.** "The spec is approved" says nothing about the product; "every criterion citing the change passed under the runner" does. Rejected: applying at approval (the tree would describe unbuilt behaviour again).
- **D3 — one place applies.** `lore rule apply` is the only writer from a change set to the tree; plan close calls it. Rejected: applying in `lore done` per task (a spec's change set is atomic; a half-applied set is a tree that matches no build).
- **D4 — no `deprecated`.** A snapshot rule is true or not; "still true, going away" belongs to the change set that will retire it.
- **D5 — review sees the right thing.** The leaf review sees only landed rules; the spec review sees the change set (the judge input for a spec includes `extra.rule_changes`).

## Migration (part of this slice)

1. BR-1080 (`baseline-resolve-a-defect-report`) and BR-1081 (`baseline-link-two-documents`), written ahead of `spec-archiving-the-work-that-resolves-a-defect-report-closes`: moved out of their leaves into that spec's change set as `add` (ids kept, registry `proposed`).
2. BR-1079 and the live-session clause of BR-1070: they land with `spec-one-worktree-removal-test-for-the-guard-lore-done-and-a`; BR-961 and BR-962 (now false) are retired with note "replaced by BR-1079 (…)".
3. The 7 `deprecated` rules: each either retired with a note (no longer true) or returned to the tree as live (still true), decided per rule from the code; the decision list is part of the task evidence.
4. This spec's own change set — applied by `lore rule apply` once its criteria pass: modify BR-86 and BR-257 (a criterion may cite a live rule or one its own spec proposes), BR-626 (a rule enters the tree as live only through apply or a direct add for behaviour that already exists), BR-641 (lifecycle moves only live→retired; proposed→live via apply; proposed→retired on abandonment), BR-643 (retired rules are tombstones outside snapshot views).

## Public Interface

```
lore rule propose <spec> add --leaf <leaf> --statement <s> --example <e>... [--enforced-by <v>]   → reserves BR-n, prints it
lore rule propose <spec> modify <BR-n> [--statement <s>] [--example <e>...] [--enforced-by <v>]
lore rule propose <spec> retire <BR-n> --note <why>
lore rule changes <spec> [--json]
lore rule apply <spec> [--json]   exit 0 applied | 4 refused (lists criteria without a runner-attested pass) | 2 usage
```

## Edge cases

| Situation | Result |
|---|---|
| AC cites BR-n proposed by its own spec | accepted |
| AC cites BR-n proposed by ANOTHER spec | refused (not live, not own change) |
| apply with one citing AC lacking a pass | exit 4, nothing applied, names the AC |
| apply with an `add`/`modify` id no criterion cites | exit 4, nothing applied, names the id (unproven change) |
| two specs modify the same live id | second propose refused while the first is unlanded, naming it |
| plan close of the implementing plan, apply would fail | plan close refused with the same list |
| spec deprecated before landing | its proposed ids retired "never landed" |
| `rule set --lifecycle deprecated` | refused, names retire / change set |
| leaf review after propose | leaf unchanged (proposed rules are not in it) |

## Acceptance Criteria

Declared with `lore ac add` (AC-CS-1..6).


## Acceptance Criteria (structured)

- [⊘] [script] AC-CS-1: Change set + citation on InMemoryStore (new file rule-change-set.test.ts): (a) propose add reserves the next BR id in registry state proposed and the leaf's rules are unchanged (byte-identical extra.rules); (b) a criterion of the same spec citing that id is accepted by the enforcing citation gate; a criterion of ANOTHER spec citing it is refused; (c) propose modify of a live id keeps the leaf's current statement until apply; a second spec proposing to modify the same id is refused naming the first; (d) lore rule show of a proposed id reports 'proposed by <spec>' with the proposed text; (e) on a locked spec propose is refused unless --correction (BR-1069 path), and with it writes one version and keeps the status. Smallest red mutation: letting the gate accept any proposed id fails (b)'s other-spec case.
  script: test — bunx vitest run packages/lore/tests/unit/service/rule-change-set.test.ts
  other_command=2
- [⚑] [script] AC-CS-2: Apply (new file rule-apply.test.ts): (a) with every criterion citing a changed id holding a runner-attested pass, apply writes each touched leaf exactly once (one version naming the spec), proposed ids become live in the leaf, modified statements replace the old ones, retired ids are retired with their note; (b) with one citing criterion lacking an attested pass (self-reported pass, expected-fail, none) nothing is written and the result names that criterion; (c) apply twice is a no-op the second time; (d) a spec deprecated or superseded before landing turns its proposed ids retired with note 'never landed: <spec>'; (f) an add or modify id that no criterion of the spec cites -> nothing written, the result names the id as an unproven change; (e) rule set --lifecycle deprecated is refused naming retire and the change set. Smallest red mutation: counting a self-reported pass fails (b).
  script: test — bunx vitest run packages/lore/tests/unit/service/rule-apply.test.ts
- [⚑] [script] AC-CS-3: Compiled CLI on a throwaway corpus with the citation gate enforcing (new file rule-change-set-compiled.bun.test.ts, hermetic session ids): lore rule propose <spec> add ... prints the reserved BR id; lore ac add citing it exits 0; lore rule changes --json lists it; lore rule apply exits exactly 4 before evidence, naming the criterion; after a runner-attested pass (lore verify) apply exits 0 and lore rule show prints the rule live on its leaf; closing the implementing plan while apply would fail is refused naming the criterion. Smallest red mutation: plan close not calling apply leaves the proposed id proposed after close.
  script: e2e — bun run build && bunx --bun vitest run packages/lore/tests/e2e/rule-change-set-compiled.bun.test.ts
  other_command=6
- [⊘] [script] AC-CS-4: Snapshot views (new file rule-snapshot-views.test.ts): the leaf's rule list, lore rule find, rule impact and baseline coverage list only live rules; proposed rules appear only in lore rule changes / lore rule show; retired rules appear only when a view asks for tombstones; the spec review judge input includes extra.rule_changes. Smallest red mutation: rule find returning proposed rules.
  script: test — bunx vitest run packages/lore/tests/unit/service/rule-snapshot-views.test.ts
  other_command=2
- [⚑] [script] AC-CS-5: Migration done on the live corpus (read-only check): no rule_registry row is in lifecycle deprecated (the 7 were each retired with a note naming what replaced them); BR-1080 and BR-1081, written into the snapshot ahead of implementation, are retired and re-proposed as BR-1082 and BR-1083 in the change set of spec-archiving-the-work-that-resolves-a-defect-report-closes; BR-961 and BR-962 are retired naming BR-1079. Measured red 2026-10-12: 7 deprecated rows. Smallest red mutation: leaving one deprecated rule fails the count.
  script: other — bun run packages/lore/src/index.ts rule find --text 'lifecycle' --json > /dev/null && test "$(sqlite3 -readonly .lore/lore.db "select count(*) from rule_registry where lifecycle='deprecated'")" = 0 && echo 'AC-CS-5 PASS: no rule left in the deprecated lifecycle after migration'
- [⊘] [script] AC-CS-6: bun run typecheck exits 0.
  script: tsc — bun run typecheck
  other_command=2

## Code anchors

- packages/lore/src/service/rule-change-service.ts
- packages/lore/src/service/rule-changes.ts
- packages/lore/src/service/landing-evidence.ts
- packages/lore/src/adapters/cli/commands/rule.ts
