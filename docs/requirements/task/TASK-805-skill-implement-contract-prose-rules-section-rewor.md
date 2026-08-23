---
id: TASK-805
type: task
role: plan
title: "skill-implement: contract prose — rules section, reworded reflow clause, eviction-stub index rule, and the template pointer"
status: archived
priority: medium
phase: "P3-grammar-rules-and-prose"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

Land the three contract-prose changes plus the template pointer, red-first. This is the half of Phase 3 whose anchors are entirely under `assets/**` — it runs concurrently with Phase 2.

## What to write, in this order

⛔ RED FIRST. Author both tests, run them, record `--result expected-fail` evidence WHILE THEY ARE RED, and only then edit the assets.

1. `packages/lore/tests/unit/assets/claude-md-contract-content.test.ts` — pins each of the three additions below by a stable literal, not by paraphrase.
2. `packages/lore/tests/integration/claude-md-template-pointer.test.ts` — the rules pointer is present in `assets/project/CLAUDE.md.template` AND in the `CLAUDE.md` that `lore setup --project` installs into a fresh `mkdtemp`.

Then the asset edits:

3. **`.claude/rules/` section** in `assets/governance/claude-md-contract.md`. This is Anthropic's own remedy for a memory file that has outgrown its budget, and the contract currently mentions it zero times. Cover: rules files live in `.claude/rules/*.md`, one topic per file; `paths:` YAML frontmatter scopes a rule so it loads ONLY when Claude reads a matching file, which is what makes it cheaper than an import; a rule with no `paths` loads every session at the same priority as `.claude/CLAUDE.md`; `~/.claude/rules/` is the user-level equivalent; and the distinction from skills — rules are resident or path-triggered, skills load on invocation. ⛔ State that moving a block to `rules/` is an EVICTION only if the destination is itself budgeted — otherwise it relocates bloat to where nothing measures it, which is the displacement failure this contract already names.

4. **Reword the reflow clause** (currently "⛔ Do not reflow long lines into short ones…"). As written it forbids the very thing a per-line readability signal encourages, and it silently pushes authors toward ever-longer lines — measured on this repo: 121 bytes/line average in the root file, 1529 bytes at the longest, which makes the 200-line target meaningless while bytes keep climbing. The rewording must separate two intents that are both valid: (a) ⛔ do not split lines to reduce the reported LINE COUNT — bytes are the binding ceiling and splitting does not reduce them; (b) very long lines are genuinely hard to scan, and an advisory line-length signal reports them without licensing (a).

5. **Bind eviction stubs to the Index-Entry Contract.** The contract already says an eviction leaves "one line" plus a resolving pointer, and separately defines an Index-Entry Contract ("one line per item, scope keywords only") for list-like sections. Make explicit that an eviction stub IS an index entry and obeys that contract. Measured: the root CLAUDE.md carries 21 such stubs, many of them multi-line paragraphs still holding the measurements they were supposed to evict.

6. **Template pointer** in `assets/project/CLAUDE.md.template` — one line telling a consumer that instructions which should not load every session belong in `.claude/rules/`.

7. ⛔ Regenerate the assets manifest in this same task, and keep `assets/project/pre-push` byte-identical to `hooks/pre-push` (parity-pinned).

## Constraints

- ⛔ `mkdtemp` + cwd inside it for the setup test. NEVER touch this repo's own `.lore/` or `.claude/`.
- ⛔ Assert exit codes EXACTLY; assert output names what it checked.
- The contract asset is the DISTRIBUTED SSOT — `lore governance claude-md` prints it byte-for-byte, so prose-only edits elsewhere do not reach consumers.

## AC covered

AC-CONTRACT-1, AC-TEMPLATE-1. Read them verbatim via `lore ac list spec-claude-md-governance-content-dimension-checks-wire-the`.
