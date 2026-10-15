---
id: SPEC-120
type: spec
role: spec
title: "git-safety-gate probes report the wrong blast radius — argument-blind probes"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-10-10
tags: []
---
# git-safety-gate probes report the wrong blast radius — an argument-blind probe turns a precise op into a catastrophic one

## Overview/Goal

`pre-bash-git-safety-gate.mjs` always blocks a matched destructive op (Design B, deliberate) and puts the REAL risk in the block message so the human decides on evidence. Two of its six probes compute that evidence **without reading the command's arguments**, so a narrowly-scoped operation is reported with the blast radius of the whole-repository variant.

Measured 2026-07-31 against the live repo (8 stash entries present), by piping a `PreToolUse` payload into the SSOT hook and reading stderr + exit code:

| Case | Command | Rendered `Segment` | Assessment |
|---|---|---|---|
| A | `git stash drop 'stash@{0}'` | `git stash drop ''` | `WOULD DESTROY these stash entrie(s):` **all 8** |
| B | `git stash drop stash@{0}` | `git stash drop stash@{0}` | `WOULD DESTROY these stash entrie(s):` **all 8** |
| C (control) | `git stash clear` | `git stash clear` | all 8 — **correct for this verb** |

Case B is the load-bearing measurement: it isolates the root cause from the quoting. `probeStash` is declared `probeStash(_inner, cwd)` — the parameter name states the fact that it never reads its argument, so it runs a bare `git stash list` whatever the verb and whatever the revision. Quote-blanking (`preprocessForInspection`, `'…'` → `''`) is a **second, independent** layer that would defeat a corrected probe as well; case A proves it reaches the probe, case B proves it is not the cause.

`probePathArg` carries the same class in a quieter form: it *declares* `inner` and never reads it, reporting the whole working tree's dirty state for `git checkout -- <one-file>` / `git restore <one-file>`. Its own comment ("paths after the git verb (best-effort; already-blanked quotes won't appear)") records the intent that was never implemented.

Why this is a defect rather than conservative rounding: the gate's entire value is that its refusals carry proportionate evidence. A gate that renders a one-entry drop as the destruction of 8 unrelated stashes — including one that belongs to another session's worktree — trains its readers to discount every warning it prints, including the true ones. This gate legitimately blocked `reset --hard` and `checkout -- <path>` twice in the session that found this.

## Scope

**In scope**

- `probeStash` becomes verb- and revision-aware: `clear` reports the whole stash; `drop <rev>` reports only `<rev>`; bare `drop` reports `stash@{0}` (git's own default target).
- `probePathArg` becomes path-scoped: it reports the dirty state of the paths named in the command, not of the whole tree.
- Probes receive the **raw** command segment, so an argument that was quoted in the original command is legible to them. Trigger matching keeps consuming the quote-blanked text, unchanged — SPEC-066's guarantee that a quoted string cannot smuggle a trigger into command position is not weakened.
- Fail-closed direction is pinned: when an argument cannot be parsed, the probe falls back to the WIDER report and labels it a fallback. Never the narrower one.
- SSOT `assets/hooks/pre-bash-git-safety-gate.mjs` + regenerated `assets-manifest.ts` sha256, so a consumer that runs `lore setup` gets the fix.

**Out of scope**

- The block/allow decision itself. Design B (always block on match, never auto-allow on a "looks safe" probe) is unchanged; only the evidence string changes.
- `probeClean`'s pathspec handling (`git clean -f -- <path>` reports repo-wide untracked files). Over-reports in the same direction, no measured incident, and its flag parsing is genuinely argument-aware already.
- Making the gate parse shell grammar properly. The argument extraction specified below is deliberately narrow and bounded by the six existing rules. **Amended by D6** — delivery required replacing the two-pass quote blanking with a single quote-aware scan, which is a step toward proper tokenisation rather than the arbitrary-grammar parser this bullet excludes.

## Argument extraction (normative)

Specified here rather than left to the implementer, because "extract the argument" is exactly the step whose under-specification produced the defect.

**Stash revision.** The rule pattern matches only `drop|clear`, so the verb set is closed and no third verb can reach this probe; a verb outside the set is unreachable by construction rather than by convention.
- `clear` → the whole stash list. No token inspection.
- `drop` → the first token after the verb that does not begin with `-`. If absent, the target is `stash@{0}` — git's own default.
- The candidate token is **resolved by git, not by a syntax rule the gate invents**: `git rev-parse --verify --quiet <token>` (as a single `spawnSync` array element). A token git resolves to a stash entry is the target; anything else takes the D4 fallback. This deliberately delegates the set of accepted revision spellings to git, so the gate cannot drift from whatever the installed git accepts.

**Paths.** For `checkout` / `restore`:
- If a bare `--` separator is present, every token after it is a path.
- Otherwise the paths are the non-flag tokens after the verb, excluding a leading `HEAD` (a ref in that position, not a path).
- Zero derived paths → D4 fallback.
- The probe invokes `git status --porcelain -- <paths>`, with the `--` separator always present, so a path that happens to look like a flag is never reinterpreted as one.

## Decisions

**D1 — the two consumers of the command text are separated.** `preprocessForInspection` blanks quoted strings so that trigger matching cannot be fooled by a quoted payload; a probe needs the opposite — the true argv. One string cannot serve both, and today's single string silently serves matching correctly and probes incorrectly. The loop therefore carries the sanitized segment (for `isCommandPositionMatch`) alongside its corresponding raw segment (handed to `rule.probe`).

**D2 — `probeDirtyTree` stays argument-blind, on purpose.** `git reset --hard` discards the entire working tree, so whole-tree `git status --porcelain` IS its exact blast radius. It is named here so that a future reader sweeping for "probes that ignore their argument" does not convert a correct probe into a wrong one.

**D3 — probes must never interpolate a command argument into a shell.** The `git()` helper is `spawnSync('git', argsArray)` with no shell, which is what makes it safe to hand probes raw, attacker-influenced text. Any new probe argument flows into that array as a single element, and the read-only-subcommand rule stands.

**D4 — an unparseable argument widens the report, never narrows it.** A probe that cannot identify its target reports the whole set, prefixed with the literal marker `Assessment: [ARG-FALLBACK]`. The marker is fixed text, not free wording, so the fallback is observable by an assertion rather than by whatever phrasing the implementation happens to choose. The inverse — silently reporting one entry when the command would destroy many — is the failure mode this spec exists to remove, and a parser bug must not be able to produce it.

**D6 (AMENDMENT 2026-07-31, post-implementation) — the two-pass quote blanking is replaced by a single quote-aware scan, and doing so closed a PRE-EXISTING under-block.**

D1 requires the raw and sanitized segments to correspond positionally, which blank-then-split cannot provide: blanking `'…'` → `''` changes the string's length, so offsets no longer line up. The implementation therefore replaced the two `String.replace` passes (old lines 297-298) with one left-to-right scan that recognises a complete quoted literal as a unit.

That change fixed a defect neither this spec nor SPEC-066 had identified. Measured by the orchestrator against both gate versions, with a control:

| command | gate at `d56ba36` | gate after this change |
|---|---|---|
| `git reset --hard HEAD` (control) | exit 2 | exit 2 |
| `echo 'it"s fine' ; git reset --hard HEAD ; echo "done"` | **exit 0 — NOT CAUGHT** | exit 2 |

Mechanism: the old double-quote pass ran FIRST and its pattern `"(?:[^"\\]|\\.)*"` paired the `"` *inside the single-quoted literal* with the opening `"` of the later `"done"`, replacing everything between them — including both `;` separators and the whole trigger — with `""`. The remaining text collapsed into a single segment beginning `echo`, which `PRINT_LIKE` classifies as not-to-inspect. A destructive `git reset --hard` passed the gate silently.

This is a seventh false-oracle face, and the most dangerous shape of it: not an oracle that measured the wrong thing, but a SAFETY GATE that reported success while the danger walked through. It needs no crafted payload — a single apostrophe-style `"` in an echoed message plus any later quoted token is enough.

The delivered scan is in the fail-closed direction (it blocks strictly more than before, and the control shows it did not become always-blocking). AC-GS-8 pins it.

**D7 (AMENDMENT 2026-07-31, post-implementation) — `extractPathArg` unquotes, though the original Scope excluded it.** Once D1 hands probes RAW text, a quoted path reaches `spawnSync` with its quote characters attached; every `git` call in `probeWorktreeForce` then fails and the probe falls through to its final `"Likely SAFE"` branch — a NARROWING that D4 forbids. Unquoting there repairs a hazard this spec's own D1 would otherwise introduce, so it is corrective rather than scope expansion. Recorded because the original Scope explicitly listed these two probes as out of scope, and a reader comparing spec to diff would otherwise find an unexplained delta.

**D5 — `Segment` is printed raw.** Today the block message prints the blanked segment (`git stash drop ''`), which misrepresents what the user typed and cost the finding session an incorrect root-cause attribution. It prints the original text.

## Acceptance Criteria

Script-mode ACs verified by `lore verify`, exercised against the SSOT hook as a child process with a synthetic `PreToolUse` payload and a purpose-built throwaway git repo — never the repo's own stash list, which is shared mutable state.

The load-bearing assertion is the **negative** one: with N>1 stash entries present, `git stash drop stash@{1}` must NOT name the other entries. A test that only asserts "stash@{1} appears" passes against today's defective all-entries output.


## Acceptance Criteria (structured)

- [⚑] [script] AC-GS-2: A quoted revision reaches the probe: the shell-quoted form of a targeted stash drop yields the same single-entry assessment as the unquoted form, and the printed Segment line reproduces the raw command instead of the quote-blanked rendering. A paired control asserts the rule still fires when the trigger itself is what got blanked, proving SPEC-066 command-position matching was not weakened to obtain the argument.
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'quoted revision reaches the probe'
- [⚑] [script] AC-GS-4: Path-scoped reporting: with two distinct dirty tracked files present, a checkout or restore naming exactly one of them produces an assessment naming that path and NOT the other. The other-path absence assertion is what distinguishes the fix from the current whole-tree report.
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'reports only the named path'
- [⚑] [script] AC-GS-6: Distribution-first: the assets manifest sha256 recorded for hooks/pre-bash-git-safety-gate.mjs equals the sha256 of assets/hooks/pre-bash-git-safety-gate.mjs on disk, so a consumer running lore setup receives the corrected gate rather than the pre-fix bytes. Without this the fix exists only in this repo working tree.
  script: test — bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts
- [⚑] [script] AC-GS-7: The whole git-safety-gate suite passes with zero failures and zero skipped cases, covering the pre-existing SPEC-066 heredoc and command-position behaviours as a regression floor. No test total is hardcoded: an asserted numeral drifts silently as the suite grows, and lore verify already guards under-match and zero-match for filtered runs.
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts
- [⚑] [script] AC-GS-1: In a throwaway git repo carrying three distinct stash entries, piping a PreToolUse payload for a targeted stash drop into the SSOT hook produces an assessment naming ONLY the targeted entry and NOT naming the other two entries by their stash messages. The negative half is load-bearing: the current all-entries output already satisfies any assertion that merely looks for the targeted entry, so a positive-only test passes against the defect.
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'names only the targeted stash entry'
- [⚑] [script] AC-GS-3: Verb dispatch is exact over the closed verb set the rule pattern admits: stash clear reports every entry; a bare stash drop with no revision reports the stash@{0} entry alone rather than the whole list, matching what git itself would drop; both still exit 2. The closure is pinned by an observable rather than an internal-control-flow claim: the payload 'git stash pop' exits 0 and its stderr contains neither BLOCKED nor WOULD DESTROY, so a rule pattern widened to admit a third verb fails this AC.
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'verb dispatch'
- [⚑] [script] AC-GS-5: Fail-closed direction is pinned in both directions, with the fallback trigger named so the assertion cannot go vacuous. Feeding the concrete unresolvable token 'stash@{99}' against a three-entry stash — a token git rev-parse --verify --quiet rejects, asserted by a control run of that same git command in the test so a future git that DOES resolve it turns the control red instead of leaving the assertion silently vacuous — yields the WIDER whole-set report carrying the literal marker [ARG-FALLBACK], never a narrower and falsely reassuring one. Separately, git reset --hard still reports the entire dirty tree with no path filtering, pinning D2 so a future argument-blindness sweep cannot convert that correct probe into a wrong one.
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'fallback widens'
- [⚑] [script] AC-GS-8: D6 regression, the under-block the quote-aware scan closed: a payload whose single-quoted literal contains a double quote that pairs with a later quoted token must still block a trigger sitting between them. Measured on the pre-fix gate as exit 0 with no Segment line — a safety gate reporting success while a destructive reset walked through — and exit 2 after. Paired with a bare-trigger control so a gate mangled into always-blocking cannot satisfy this vacuously.
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'D1 REGRESSION'

## Code anchors

- assets/hooks/pre-bash-git-safety-gate.mjs
