---
id: KN-594
type: knowledge
role: knowledge
title: "Fresh-install consumer probe 2026-10-11 slice 3 exit criterion"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: SPEC-164
---
# Fresh-install probe — product-baseline slice 3 exit criterion

- Binary: `/Users/apple/Projects/zz/lore/.claude/worktrees/agent-a3782bb5f45044f34/dist/lore`, built from worktree HEAD `42b3c69e` (== `main` at probe time; `bun run build` exit 0, provenance `42b3c69e…`, build_dirty false).
- Consumer: `…/scratchpad/probe.xgQVo8` (git init + `package.json` + `src/a.ts`, one commit, no `node_modules`). `LORE_ACTOR=agent:probe`, `CLAUDECODE=1`.
- Variant B: `…/scratchpad/probeB` = a copy of the probe taken after step 22 with `lore.tree.yaml` moved aside. Used ONLY to get past F1 so the approve/citation path (d7/d8) could be exercised. Rows from B are marked (B).
- Global skills were inspected by installing `lore setup --claude-dir <scratchpad>/claude-home --yes` (never `~/.claude`).
- Per-step raw output: `…/scratchpad/steps/<id>.log`; index with exit codes: `…/scratchpad/steps/index.txt`. Every exit code was measured without a pipe.
- The repo's `.lore/` and the main checkout were not touched. The probe has no `feedback.upstream`, and `lore` has no `-C` flag, so `lore issues --local --all` on the repo was skipped and nothing was filed (per instructions). A read-only grep of the worktree's exported mirrors under `docs/requirements/` found no prior report of F1, F4, F6, F8 or F9.

## Results

| # | Step | Command | Expected | Exit | Observed | Verdict |
|---|---|---|---|---|---|---|
| 0 | baseline | `git log -1`; `git rev-parse main` | HEAD contains main | — | both `42b3c69e` | PASS |
| 1 | init | `lore init --author agent:probe` | 0 | 0 | `.lore/lore.db` + `config.yaml` created | PASS |
| 2 | setup | `lore setup --project --yes` | 0 | 0 | hooks, tree blueprint, CLAUDE.md, `Adoption: written — enforce`, `Baseline skill: 3 of 3`, `AC-cite gate: report`. Next steps still say `/lore-kickoff … (root PRD + first spec)` | PASS |
| a1 | status | `lore status --json` | `ac_cite` present | 0 | `"ac_cite": {"mode":"report","provenance":"unaudited"}` | PASS |
| a2 | status | `lore status --json` (after docs exist, step 30) | baseline fields | 0 | `baseline{rules_total,…,acs_citing,acs_uncited,cites_dangling,…}`, `specs_without_citation`, `specs_with_parent`. None of these appear on an empty corpus (step 03). | PASS |
| a3 | status | same | provenance honest | 0 | The value `setup --project` seeded is labelled `unaudited`. The shipped `lore-baseline/SKILL.md:106` says "`unaudited` means the config was hand-edited". Nobody edited it. **F5** | FAIL |
| b1 | skills | `ls .claude/skills` | `lore-baseline` present | — | project: `.claude/skills/lore-baseline/{SKILL.md,templates/branch.md,templates/leaf.md}`; global install also has `skills/lore-baseline` | PASS |
| b2 | skills | `grep -rn 'create spec[^|]*--parent'` over the project `.claude`, `CLAUDE.md`, `hooks`, and the global install | 0 | 1 / 0 | project: 0. Global: 1 hit (`lore-kickoff/SKILL.md:124`). The regex matched across `create spec --kind tech`; … `create plan --parent`. That is a false positive, so the literal count is 0. | PASS |
| b3 | skills | the global `skills/lore/SKILL.md:44` | no "spec needs parent" | — | Table "Required besides --title": `spec \| --parent <id-or-slug>`. This contradicts d3. **F2** | FAIL |
| b4 | skills | the global `skills/lore-kickoff/SKILL.md:83-86` | consistent | — | Line 82 says "a spec takes no parent". Line 86 says "**Every spec needs a parent**". Kickoff has no `baseline add`/`rule add` step at all, yet line 83 needs `--cite BR-<n>` to approve. Following kickoff leads to a spec that can never be approved. **F3** | FAIL |
| c1 | baseline | `baseline add prd-probe-strategy --node root …`; `… --node branch`; `… --node leaf` | 0 | 0/0/0 | root, branch and leaf created (a root must have a PRD parent) | PASS |
| c2 | rule | `rule add baseline-pay-leaf … --confidence established` / `unconfirmed` | 0 | 0/0 | `Added BR-1 … (v2)`, `Added BR-2 … (v3)`. Note: `SKILL.md:59` says an unconfirmed rule needs an owner and a question. This is not enforced; BR-2 was accepted without either. | PASS |
| c3 | tree | `baseline tree` | lists the tree | 0 | `leaf Pay … [rules: live 2 / deprecated 0 / retired 0]` | PASS |
| c4 | arch | `baseline add --tree architecture` root / section / standard | 0 | 0/0/0 | created | PASS |
| c5 | AS rule | `rule add baseline-result-type-standard … --current-reality … --target-rule … --current-exceptions-none --migration …` | 0 | 0 | `Added AS-1`. It accepted "Two modules still throw" together with `--current-exceptions-none`. They contradict each other, but no tool could check that mechanically. | PASS |
| d1 | prd | `create prd --title "Probe Strategy"` | 0 | 0 | created. `created_by: "system"` despite `LORE_ACTOR=agent:probe` (also true for every doc in `get`) | PASS |
| d2 | spec | `create spec` with no `--parent` | 0 | 4 → 0 | The first attempt had a body without the skeleton and got `MISSING_SKELETON`, which is a correct gate. With `## Overview/Goal`/`## Scope`/`## Acceptance Criteria` it exits 0. | PASS |
| d3 | spec | `create spec --parent prd-probe-strategy` | 4 | 4 | `a spec takes no parent … cite with lore ac cite …` | PASS |
| d4 | ac | `ac add spec-pay-once-spec AC-PAY-1 … --command 'true && echo ok' --cite BR-1` | 0 | 0 | added. An uncited AC (step 22) gets exit 0 plus a `Hint:` in report mode. | PASS |
| d5 | review | `review spec-pay-once-spec` | review usable | 0 | `Decision: reject (1.00)`: `tree_position fail — doc's parent type '(none)' does not match any modeled position for 'spec' in lore.tree.yaml`. The blueprint was written by `setup --project` and its own comment says a parentless spec is neither orphan nor misplaced (BR-400). `status --check-tree` (step 31) agrees with that comment. Only `checkTreePosition` (`packages/core/src/review-checks.ts:186-211`) has no parentless-spec case. **F1** | FAIL |
| d6 | approve | `approve spec-pay-once-spec` (cited) | 0 | 4 | `JUDGMENT_REJECTED`. In a fresh install **no spec can be approved**: with a parent, create refuses it; without one, review rejects it. The worst-decision-wins rule also makes the reject stick to that version (B2: still rejected after the blueprint was removed). **F1** | FAIL |
| d7 | approve | (B) `approve spec-b-uncited-spec` (uncited, fresh judge approve) | 4 | 4 | `cites no live business or architecture rule … cannot be approved` (BR-1007 path). In A this path is unreachable: the review gate fires first (step 26). | PASS (B) |
| d8 | approve | (B) `approve spec-b-cited-spec` | 0 | 0 | `→ approved (v3)`. (B) citing AS-1 also admits approval (B14 exit 0). | PASS (B) |
| d9 | review AI | `review … --no-ai` | per help | 2 | `lore review requires AI`. Help says review is AI on every surface, so under `CLAUDECODE=1` it called claude-cli (B1 `Judge: claude-cli`). This is by design. | PASS |
| e1 | get spec | `get spec-pay-once-spec` | Implements | 0 | `── Implements (1 citation) ── BR-1 -> baseline-pay-leaf: AC-PAY-1`; `Parent: (none)` | PASS |
| e2 | get leaf | `get baseline-pay-leaf` | Implemented by | 0 | `── Implemented by ── BR-1: spec-pay-once-spec (draft) AC-PAY-1`. The rules themselves are hidden by default (`rules array · 2 item(s) … --json`). | PASS |
| f1 | budget | `status --check-prd-budget` | 0 | 0 | `PRD budget: within budget (1)`, `Baseline node budget: within budget (6)` | PASS |
| f2 | census | `status --json` | census fields | 0 | `specs_without_citation {count:1, [spec-uncited-spec]}`, `specs_with_parent {count:0}` | PASS |
| f3 | census | `status --json` | all live rules counted | 0 | `baseline.rules_total: 2` with 3 live rules (BR-1, BR-2, AS-1). AS rules are silently excluded: `rule-state-service.ts:216` collects only `node === "leaf"`. In B, an AC citing AS-1 counts in `acs_citing`, but AS-1 is in neither the rules total nor the verification counts. **F6** | FAIL |
| f4 | tree check | `status --check-tree` | 0 | 0 | `Tree is consistent with lore.tree.yaml blueprint.` | PASS |
| g1 | sites | `baseline sites 'ac add'` (compiled binary, no node_modules) | run, or fail loudly | 4 | `census:command-unresolved {"reason":"not inside a lore source checkout (packages/lore/src/adapters/cli/commands not found upward from cwd); the census analyses source, an installed binary has none"}`. It fails loudly (good), but it can never work in a consumer project, and the shipped `lore-baseline/SKILL.md:92` tells consumers to use it. **F4** (#60 territory) | FAIL |
| g2 | coverage | `baseline coverage baseline-pay-leaf` / `… baseline-checkout-branch --json` | 0 when complete | 4/4 | Same `command-unresolved` error, even for a leaf that never ran `baseline map` and declares no commands. `SKILL.md:93` advertises it. **F4** | FAIL |
| h1 | adopt | `baseline adopt --mode enforce`, then an uncited `ac add` | refused | 0 / 0 | `Adopted: mode report -> enforce; armed branches []`. Status now says `{mode:"enforce", provenance:"audited"}`, yet the uncited AC-UNC-2 is admitted with only a hint. With zero armed branches, "enforce" enforces nothing, and `status --json` has no armed-branch list that would show it. **F7** | FAIL |
| h2 | adopt+arm | `adopt --mode enforce --arm baseline-checkout-branch`; uncited `ac add` | refused | 0 / 4 / 4 | `Error [AC_CITE_REQUIRED]: … cites no rule. Nothing was written.` (for both the uncited spec and the cited spec) | PASS |
| h3 | cited | `ac add … AC-PAY-3 … --cite BR-2` | admitted | 0 | added | PASS |
| h4 | recovery | the refusal's own hint `ac cite spec-pay-once-spec AC-PAY-2 BR-1` | works | 4 | `Acceptance criterion "AC-PAY-2" is not declared on this spec`. The hint names `ac cite` for an AC the same message says was not written. The working fix is `ac add … --cite`. **F8** | FAIL |
| i | migrate | `migrate spec-parents` | preview 0 | 0 | `Specs would clear: 0` | PASS |
| j1 | bootstrap | `bootstrap` | root = baseline, PRD as Strategy | 0 | `Root: baseline-probe-business-baseline` / `Strategy: prd-probe-strategy`. `Armed gates (5)` lists spec-create, spec-promote, plan-promote, task-claim and plan-close, but not the enforce+armed ac-cite gate (observation). | PASS |
| j2 | tree | `tree` | default root = baseline | 0 | Root is the business baseline root, but `tree --help` still says `ROOT … (default: first PRD)`. The default view shows no Strategy PRD, no architecture tree and no specs. **F9** | FAIL |
| j3 | tree | `tree prd-probe-strategy` | well-formed | 0 | Depth-3 lines are drawn wrong: `│   │       └── Result Type Standard` and `        └── Pay Leaf` have a stray `│` and 4 extra spaces. The default-root render (step 45) is correct. **F10** | FAIL |
| j4 | orphans | `tree --orphans` | specs not orphans | 0 | `No orphan documents.` | PASS |

**Counts: 29 PASS, 12 FAIL rows, covering 10 distinct defects.**

## Defects

- **F1 (critical, blocks the loop)**: review's deterministic `tree_position` check rejects every parentless spec against the blueprint that `setup --project` ships. Combined with `create spec --parent` → exit 4, a fresh consumer cannot approve any spec. `checkTreePosition` (`packages/core/src/review-checks.ts:186-211`) has no parentless-spec case. `status --check-tree` and the blueprint's own comment (BR-400) both treat parentless specs as valid. Also, the reject judgment sticks to the doc version under worst-decision-wins, so the fix must cover existing rejected versions too (they need a version bump).
- **F2**: the shipped `lore` skill (`assets` → `skills/lore/SKILL.md:44`) lists `--parent` as required for spec.
- **F3**: the shipped `lore-kickoff` skill line 86 says "Every spec needs a parent". Kickoff never creates a baseline tree or rule, but its spec step needs `--cite BR-<n>` to approve, so the kickoff path is a dead end. `setup --project` "Next steps" points to it ("root PRD + first spec").
- **F4**: `baseline sites` / `baseline coverage` exit 4 in any consumer project (the census reads lore's own source). The shipped `lore-baseline` skill (lines 92-93) advertises both. `coverage` fails even for a leaf with no mapped commands.
- **F5**: `ac_cite.provenance` is `unaudited` for the value `setup` seeded. The shipped skill defines `unaudited` as "hand-edited", so the label is false.
- **F6**: `status --json` `baseline.rules_total` / `rules_by_lifecycle` / `rules_by_verification` silently omit architecture (AS) rules. Only leaves are scanned.
- **F7**: `adopt --mode enforce` with no armed branch reports mode `enforce` but refuses nothing, and status shows no armed-branch list.
- **F8**: the `AC_CITE_REQUIRED` refusal suggests `lore ac cite <spec> <unwritten-ac> …`, which fails (exit 4, AC not declared).
- **F9**: `tree --help` says the default root is "first PRD"; it is actually the baseline root, and the PRD (Strategy) is not shown.
- **F10**: `lore tree <prd>` draws connectors and indentation wrong at depth 3.

Observations (not counted): `created_by: "system"` on every doc despite `LORE_ACTOR`; the unconfirmed-rule owner/question requirement is not enforced; `get <leaf>` hides the rules by default; `bootstrap` armed-gates list omits ac-cite.

## Verdict

**The slice-3 exit criterion is NOT met.** Init, setup, the baseline/architecture trees, rules, the parentless-spec create contract, citations, the Implements/Implemented-by views, the census fields, check-tree, the spec-parents migration and the bootstrap root/Strategy all work from a fresh install with the compiled binary. But the loop cannot close: a fresh consumer cannot approve any spec, because `lore review`'s `tree_position` check rejects parentless specs against the blueprint that `setup --project` itself ships (F1). The BR-1007 citation gate on approve could only be shown in a modified copy with the blueprint removed. The consumer-facing guidance also still teaches the old model: the `lore` skill requires `--parent` for spec, and kickoff says "every spec needs a parent" and skips the baseline entirely (F2, F3). It also advertises `baseline sites`/`coverage`, which cannot run outside a lore source checkout (F4). Five smaller honesty and rendering defects (F5-F10) remain. F1 through F4 must be fixed on shipped surfaces (`@lore/core` review checks and `assets/` skills), then this probe re-run, before the criterion can be signed off.
