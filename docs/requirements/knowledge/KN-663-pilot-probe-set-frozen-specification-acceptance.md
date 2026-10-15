---
id: KN-663
type: knowledge
role: knowledge
title: "Pilot probe set (frozen) — specification & acceptance"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: [baseline, pilot-probe]
parent: PLAN-172
links:
  - {id: PLAN-172, type: informs}
---
Frozen pilot probe set (10 boundary questions) for the baseline specification-branch pilot, domain: specification and acceptance. Each answer was verified by reading code and/or running the CLI against a throwaway corpus (fresh `lore init`, never this repo's corpus). Do not edit after creation.

## Questions

1. Which of these attempts to create a specification are refused at creation, and which are accepted? (a) placing it under another specification; (b) placing it under an architecture decision record; (c) giving it no parent at all; (d) placing it under a product requirements document with the "narrative domain overview" kind; (e) placing it under a product requirements document with a made-up kind called "research"; (f) placing it under a product requirements document and declaring a code anchor on a source file that does not exist yet; (g) the same as (f) but the anchor path begins with a slash.

2. A new specification is created under a valid parent. Its body contains exactly one section heading, titled "Notes", and no sections about overview, scope or acceptance criteria. Is creation accepted? Separately, is a body whose only heading is a third-level heading accepted?

3. In a freshly initialised project with no custom configuration, a specification of the "narrative domain overview" kind declares zero acceptance criteria. Can it be moved to "in review"? Can it be approved?

4. An approved specification has a criterion that a task's recorded evidence points at. Someone withdraws that criterion. What happens without an override, and what happens to the evidence and to the specification's status with the override?

5. For a specification that is currently approved, which of these four actions send it back to draft? (a) adding a new criterion; (b) withdrawing a criterion that has no evidence; (c) rewriting an existing criterion with text identical to what it already says; (d) changing only which product requirements an existing criterion covers.

6. A specification is approved. Its author rewrites one existing criterion to read "The system is blazing fast and elegant" (no numbers, checked by a human). Is the rewrite refused? At what first point does the system refuse this wording?

7. Criteria are added one at a time, each checked by a human. Which single one of these statements is refused by the wording check, and why are the others accepted? (1) "The fast-path cache is used"; (2) "Section 3 is simple and elegant"; (3) "Latency is low"; (4) "The export works"; (5) "It is Secure"; (6) "Output is secure-by-default".

8. The statement "Simple and elegant" (no numbers) is declared with four different ways of checking it: (i) a runnable command; (ii) an AI judge whose guidance says "judge it holistically"; (iii) an AI judge whose guidance says "at most 3 reviewers disagree"; (iv) human sign-off. Which of the four are refused?

9. When declaring a command-checked criterion with an intentional-failure mutation: if only the target file is supplied and the other three mutation fields are omitted, what happens? And if the full mutation is supplied while declaring a human-checked criterion, what happens at declaration time, and what is stored?

10. A command-checked criterion's command runs a test file that does not exist yet. Is it accepted as declared? What is the way to declare it anyway, and does the same rule apply when later editing the command of an existing criterion?

## Answers and evidence

Method note: "CLI run" means executed against a throwaway corpus created with `lore init` in a scratch directory outside this repo; the first listed code location is the SSOT.

### 1 (PROSE-vs-CODE discriminator on part d)
Answer: refused = (a), (b), (c), (e), (g); accepted = (d), (f).
- Parent contract: `packages/core/src/doc-type-rules.ts:13-15` (`spec: ["prd"]`); gate predicate `packages/lore/src/service/gate-predicates.ts` parentLegal (~line 190). CLI run: spec under spec and under adr and under plan -> exit 4 "Invalid parent type for 'spec'. ... Allowed parent types: prd"; no parent -> "Documents of type 'spec' require a parent".
- Kinds: `packages/core/src/spec-kind.ts:30` lists four kinds incl. domain-overview; `gate-predicates.ts:209` specKindValid. CLI run: `--kind domain-overview` created OK; `--kind bogus` -> exit 4 "Expected 'feature' | 'tech' | 'design' | 'domain-overview'".
- Prose conflict: the compiled-in rule text printed when a creation is refused (`packages/lore/src/service/corpus-service.ts:184-185`) says spec_kind is "one of feature, tech, or design" - it omits the fourth accepted kind.
- Code anchors: `packages/core/src/code-anchors.ts` (symbol grammar ASCII identifier; repo-relative, no ".."). CLI run: anchor `nonexistent/file.ts` accepted (only drift-checked later); `/abs/path.ts` -> exit 4 "file anchor must be repo-relative (no leading "/")"; `a/b.ts#Foo` accepted and stored.

### 2 (PROSE-vs-CODE discriminator)
Answer: accepted. The only structural requirement enforced is the presence of at least one level-2 heading line ("## " followed by whitespace) anywhere in the body. A body with only a level-3 heading, or "##Foo" (no space), is refused.
- `packages/lore/src/service/gate-predicates.ts:220` (`SKELETON_HEADING_PATTERN = /^##\s/m`), `:234` hasSkeleton; wired in `packages/lore/src/service/checkpoint-registry.ts:846` checkSpecCreate.
- CLI run: body "## A\nx" created; body "plain text only" -> exit 4 `MISSING_SKELETON`; "### only h3" and "##Foo" -> exit 4 `MISSING_SKELETON`.
- Prose conflict: the rule text shown on refusal (`corpus-service.ts:186-187`) says content "must include at minimum: ## Overview/Goal, ## Scope, ## Acceptance Criteria"; no section name is checked.

### 3 (PROSE-vs-CODE discriminator)
Answer: can enter "in review" (yes); cannot be approved (refused, needs at least 1 criterion) in an unconfigured project.
- The AC-count floor fires only on the transition to approved: `packages/lore/src/service/corpus-service.ts:2286-2294` (`newStatus === "approved" && existing.status !== "approved"`). Floor resolves to `DEFAULT_MIN_ACS = 1` unless a configured verification profile sets `min_acs`: `gate-predicates.ts:962` and `:1000-1007`.
- CLI run: `lore set spec-dom --status in-review` -> exit 0; `lore gate spec-promote --spec spec-dom` -> exit 4 `spec "spec-dom" has no structured acceptance criteria (needs >= 1 for spec_kind "domain-overview")`; same for `lore approve` once the review-judgment requirement was switched off in the throwaway config.
- Prose conflict: `packages/core/src/spec-kind.ts:22-26` says the kind "carries an explicitly LIGHTER ... floor (no AC requirement)" and the `acCountMeetsFloor` JSDoc (`gate-predicates.ts:971-973`) says "SPEC-080 C2 promises a domain-overview spec ... needs no declared ACs at all". Code only waives it when a profile with `min_acs: 0` is configured; the default config declares none.

### 4
Answer: without override: refused (exit 4) naming the task whose evidence references the criterion. With the override: removed; the evidence keeps its criterion reference and becomes dangling; spec status unchanged (an approved spec stays approved - removal never demotes).
- `packages/lore/src/service/ac-service.ts:435` removeCriterion (force check around :454-470); header invariant at `:57-63`. Test: `packages/lore/tests/unit/service/ac-service.test.ts` "removeCriterion without --force fails when a task under a child plan has evidence referencing the id".
- CLI run: `lore ac rm spec-solo AC-S-2` -> exit 4 'Cannot remove "AC-S-2" - task "task-solo-task" has evidence referencing it. Pass --force ... (existing evidence keeps its ac_ref and becomes dangling)'; `--force` -> removed, exit 0; spec status read back `approved`. A non-existent id -> exit 4 "does not exist on this spec" (and force does not change that).

### 5
Answer: only (c) and (d) demote to draft. (a) and (b) leave it approved. (Also: withdrawing the last remaining criterion of an approved spec leaves it approved with zero criteria; nothing re-checks the floor.)
- `packages/lore/src/service/ac-service.ts:507` setCriterion applies `resolveStatusAfterContractEdit(spec.status, true)` at `:623` (always a contract change; only an empty patch is refused first); add (`:309`) and remove (`:435`) write a version row but never demote (header `:12-17`, `:70-76`). SSOT rule: `packages/core/src/schemas.ts:944-952`. Test: `ac-set.test.ts` "demotes an approved spec to draft".
- CLI run on an approved spec: `ac add` -> status still approved; `ac rm` -> still approved; `ac set --statement <same text>` -> Notice "this edit demoted spec ... from approved to draft", status draft; re-approve then `ac set --covers R-1` -> demoted again. Removing the only criterion of an approved spec -> status still approved, `ac list` says none declared.

### 6 (PROSE-vs-CODE discriminator)
Answer: the rewrite is NOT refused (it succeeds and demotes the spec to draft). The wording is first refused when re-approval is attempted (`AC_NOT_QUANTIFIABLE`, naming "fast" and "elegant"); `lore gate spec-promote` reports the same earlier.
- Lint call exists only in the add path: `packages/lore/src/service/ac-service.ts:342` (inside addCriterion). `setCriterion` (`:507-640`) has no `lintAcQuantifiability` call. Backstop: `gate-predicates.ts:848` acQuantifiable via checkSpecPromote (`checkpoint-registry.ts:917`).
- CLI run: `lore ac set spec-s-ok AC-A-3 --statement "The system is blazing fast and elegant"` -> exit 0, spec demoted; `lore approve spec-s-ok` -> exit 4 `AC_NOT_QUANTIFIABLE` with lines for "fast" and "elegant"; after rewriting to "AC three: p95 < 200ms" approve succeeds.
- Prose conflict: the service header (`ac-service.ts:51-58`) presents add as the "immediate-feedback layer" and the gate as "backstop for ACs added through any other path", which reads as if edits were covered up front; the compiled-in creation rule says every AC must be deterministic and checkable.

### 7 (PROSE-vs-CODE discriminator on item 4)
Answer: only (5) "It is Secure" is refused (abstract word "secure", matched case-insensitively, no measurable anchor). (1) accepted: the abstract word is only a hyphen-joined part of "fast-path"; (2) accepted: any digit anywhere in the statement counts as a measurable anchor; (3) accepted: "low" is not on the abstract-word list; (4) accepted: "works" is not on the list; (6) accepted: hyphen-adjacent match is skipped.
- `packages/core/src/ac-quality.ts:90-125` word list (33 entries, no "works"/"support"/"low"); `:143` digit rule, `:154` unit tokens, `:163` hasMeasurableToken; `:201-208` hyphen-adjacent skip for ASCII words.
- CLI run (human mode): (1) added; (2) added; (3) added; (4) added; (5) -> exit 4 'abstract word "secure" has no measurable anchor'; (6) added. Also "Is it good?" refused.
- Prose conflict: rule text (`corpus-service.ts:188-190`) says vague verbs ("works", "support") are rejected; code never rejects them (statements "The export works" and "The importer supports all formats" were added with exit 0).

### 8
Answer: (ii) and (iv) are refused; (i) and (iii) are accepted.
- `packages/core/src/ac-quality.ts:350` script-mode criteria are never linted; `:354` AI-mode is exempt only when its rubric itself contains a measurable token (digit, comparison, percentile, unit); human mode has no exemption.
- CLI run with statement "Simple and elegant": script (lint oracle, `echo ok`) -> added; ai rubric "judge it holistically" -> exit 4 abstract word "simple"; ai rubric "at most 3 reviewers disagree" -> added; human -> exit 4.

### 9 (declaration-form boundary; help text only says "script mode only")
Answer: partial mutation declaration is refused at declaration time ("Required" on the first missing field, e.g. `verify.falsifier.find`), nothing stored. The full mutation declared on a human-checked criterion is accepted silently and DROPPED: the stored criterion has only mode human, no falsifier (the edit command, by contrast, refuses such flags for a non-script criterion).
- Schema: `packages/core/src/acceptance.ts:164-169` (all four fields required together), `:201-222` falsifier lives only on the script branch.
- CLI run: `ac add ... --mode script --falsifier-path a.ts` -> exit 4 `acceptance_criteria.5.verify.falsifier.find: Required`; `ac add ... --mode human --falsifier-path a.ts --falsifier-find a --falsifier-replace b --falsifier-exit-code 1` -> exit 0, `lore get --json` shows AC-F-2 `verify: {mode: "human"}` only; `ac set <human AC> --falsifier-*` -> exit 4 "--falsifier-* only applies to a "script"-mode criterion"; `ac set <script AC> --falsifier-path a.ts` alone -> exit 4 `...falsifier.find: Required`.

### 10
Answer: refused (exit 4) naming the missing path; it can be declared only by passing a non-empty written reason for the missing path (an explicit "red-first" declaration, tracked as unredeemed until the file exists). Yes, the same refusal applies when editing an existing criterion's command to one that names a missing test file.
- `packages/lore/src/service/ac-service.ts:109` imports `findMissingOracleFiles`; write-path check on a candidate script criterion at `:946` (applies to a non-script candidate as a no-op, `:944`); unredeemed-declaration recount at `:705`.
- CLI run: `ac add ... --command "bunx vitest run tests/unit/nothing.test.ts"` -> exit 4 "Declared script-mode command names path(s) that do not exist yet ... pass a non-empty --allow-missing-path"; with `--allow-missing-path "red-first"` -> added; `ac set <script AC> --command "<same missing path>"` -> exit 4 same refusal. Also a script criterion missing its command or oracle -> exit 4 "Required".
