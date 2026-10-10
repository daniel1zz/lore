---
name: lore-baseline
description: "Use when a requirement must become durable business documentation before code: author a product baseline tree (root / branch / leaf) with permanent rule ids, cite rules from acceptance criteria, and adopt the citation gate. Triggers: 'baseline', 'business rules', 'rule add', 'baseline tree', 'ac cite', 'baseline adopt', '业务基线', '业务规则', '需求拆解'. NOT for technical design or one-off specs."
---

# Lore Baseline Authoring

The baseline is the product's durable business-rule tree. It outlives any one spec: requirements flow
*through* it, each change edits the affected leaves instead of spawning a new document. Specs implement the
baseline; they never restate it.

Three guarantees decide whether anything belongs here: **one requirement, one reading** (nothing downstream
restates a rule, it cites the rule id) / **no ambiguity** (a term means one thing, a threshold has a side, a
failure has a named outcome) / **acceptable** (done is a check that passes or fails, not an opinion).

## The boundary: business only

Nothing in a baseline says how the system is built: no storage, no service or module names, no field names, no
file paths, no test runner. `submit refund` is a business point; `RefundService.validate` is an implementation.
An implementation copied into a rule makes whoever builds against it reproduce that implementation's defects as
if they were the requirement. `lore rule add` refuses statements over 500 characters; the rest is on you.

## Shape of the tree

| Node | Answers | Carries |
|---|---|---|
| **root** | What does the product do, and where does it end? | Scope, boundary, glossary. No rules. |
| **branch** | What is inside this area, and who owns what? | Children list, inside/outside boundary, glossary. **No rules.** |
| **leaf** | One verb: what exactly happens? | The rules (permanent ids), `Depends on`, nothing else. |

- **One verb per leaf.** If the leaf's one-sentence description needs "and" or "or", split it.
- A branch is a bounded context: draw it where the *language* changes, not where code layers change.
- Rules live in leaves only. A rule at a branch gives readers two places to look and no way to know which is current.

## A leaf's content: Command, Constraint, Domain Event

Every business point reads as three lines, in business language:

- **Command**: who triggers it, with what (`customer requests a refund`).
- **Constraint**: the business rule that governs it (`refund allowed within 30 days of delivery`).
- **Domain event**: what has happened, past tense (`refund approved`).

Rules are the Constraint lines made individually addressable. Prefer boundary examples (the 30th day, the 31st)
over happy paths; every rule needs 1-3 concrete examples.

## Rules have permanent ids

A rule is `BR-<n>`, allocated by lore, edited in place, **never renumbered and never versioned**. There is no
`v1` frozen beside `v2`; history lives in git and the audit trail. Write rules only with the commands, never by
hand-editing the leaf body.

| Confidence | Meaning |
|---|---|
| `established` | The business has settled this. |
| `observed` | Seen in the running product; nobody has confirmed it is intended. |
| `unconfirmed` | Someone proposed an answer; it still needs agreeing. |
| `undecided` | The business has not made this call. |

Every `unconfirmed` / `undecided` rule needs an owner and a question in the leaf, otherwise a guess quietly
becomes a fact. `--enforced-by` says whether a user can get past the rule: `guaranteed` (holds however they got
there), `both` (guaranteed and the interface warns early), `prompt-only` (only the interface asks). `prompt-only`
on money or permission is almost always an assumed guarantee nobody built: record it as `undecided` instead.

State rounding and sides of thresholds explicitly ("30 days inclusive", "round down to the cent").

## Depends on

When a leaf's rule is only valid because another leaf's rule holds, declare it: `lore baseline depends <leaf>
--add BR-n`. Depend on rule ids, never on a leaf as a whole, and never in prose.

## Method

1. **Locate what exists.** `lore baseline tree` before adding; most requirements change existing leaves.
2. **Interrogate before writing.** For each requirement ask: what happens on failure, on the boundary value, on
   repeat, on concurrent use, who is refused and what they see. A PRD describes the happy path; the gaps are the work.
3. **Grow from real work.** Add only the leaves a requirement touches. Bulk extraction produces documents that
   are stale on delivery.
4. **Write the leaf, then its rules**, then cite them from acceptance criteria.

## Lore command map

| Step | Command |
|---|---|
| Create a node | `lore baseline add <parent> --node root\|branch\|leaf --label <l> --title <t> [--content-file <path>]` |
| Rename a label | `lore baseline set-label <node> <label>` |
| Add a rule | `lore rule add <leaf> --statement "..." --confidence established --enforced-by guaranteed --example "..."` |
| Edit / deprecate / retire / move a rule | `lore rule set BR-n [--statement ...] [--lifecycle deprecated\|retired --note ...] [--move-to <leaf>]` |
| Glossary term | `lore baseline glossary add <node> --term <t> --meaning <m>` (root, branch only) |
| Declare a dependency | `lore baseline depends <leaf> --add BR-n` |
| Cite a rule from a criterion | `lore ac cite <spec> <ac-id> BR-n` |
| See the tree and rule states | `lore baseline tree [--states] [--rule BR-n]` |
| Map failure sites to rules | `lore baseline sites <command>`, then `lore baseline map <leaf> --command <name> --site <key> --rule BR-n` (or `--non-business <reason>`) |
| Check coverage of a leaf or branch | `lore baseline coverage <leaf\|branch>` |
| Adopt the citation gate | `lore baseline adopt --mode report\|enforce [--arm <branch-slug>]... [--disarm <branch-slug>]...` |

Node bodies start from `templates/branch.md` and `templates/leaf.md` (pass with `--content-file`). Rules are
never in the body: they go through `lore rule add`.

## Adopting the gate

`lore setup --project` seeds `workflow.gates."ac-cite".mode: report` when absent: criteria that cite no rule
are reported, never refused. Move to refusal one branch at a time, so a half-written tree never blocks work:

1. Finish a branch: every leaf has rules, every rule has examples.
2. `lore baseline adopt --mode enforce --arm <branch-slug>`: new or revised criteria under that branch must cite a live rule.
3. `lore status --json` shows `data.ac_cite = { mode, provenance }`; provenance `audited` means `adopt` produced the mode, `unaudited` means the config was hand-edited, `default` means nobody set it.

`adopt` writes the config and exactly one audit row (old and new settings); it prints `no change` and writes
nothing when the request is already the current state.

## Anti-patterns

- A rule that names a table, endpoint, class or file. Rewrite it as the business fact it implements.
- "The system should handle errors gracefully": name the failure and the outcome, or it is not a rule.
- Two leaves stating the same threshold. Keep one, cite it from the other via `Depends on`.
- Restating a rule's text in a spec or task. Cite `BR-n`.
- Renumbering or recreating a rule to "fix" it. Edit it in place with `lore rule set`; retire it if it is dead.
- A leaf with several verbs, or a branch that carries rules.
