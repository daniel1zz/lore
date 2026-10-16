---
id: SPEC-185
type: spec
role: spec
title: "Always-loaded lore fragments state the rule only; reasoning is tier 2"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-16
tags: [fragments, content-tiers, rules]
links:
  - {id: SPEC-182, type: relates-to}
  - {id: ADR-047, type: relates-to}
  - {id: KN-696, type: relates-to}
---
## Overview/Goal

The always-loaded lore fragments (rendered into every consumer's `.claude/rules/lore-*.md` and into this repo's) state each rule only. The reasoning, mechanism walkthroughs and dated measurements behind a rule are tier 2 under the CLAUDE.md content contract's Content Tiers rule (`assets/governance/claude-md-contract.md`, 101fd79b): they are read by whoever changes the rule, which happens only in this repository, so they live in this repo's corpus, not in shipped text.

Follows `spec-always-loaded-rules-keep-only-what-no-checkpoint-enforces` (landed): that spec decided WHICH rules stay always-loaded (BR-1094: only rules no checkpoint enforces); this spec changes only HOW those remaining rules are worded. No rule moves tier, none is dropped.

The verbatim pre-change source of all ten fragments is preserved in `knowledge-always-loaded-lore-fragments-verbatim-source-before` (base commit b049f0ab).

## Scope

In scope — the ten fragments rendered into this repo's always-loaded project rules at b049f0ab:
`assets/context/{ac-design,corpus-workflow-0-overview,corpus-workflow-1-feed,corpus-workflow-2-produce,corpus-workflow-3-execute,corpus-workflow-4-close,dispatch-bundle,evidence-attestation,worktree-dispatch}.md` and `.lore/context/scoped-oracles-in-worktrees.md`.

- Each bullet keeps its rule (what to do / never do, the command, the threshold) and drops explanation, examples of the failure, and dated measurements.
- Every `lore <verb>` the fragment names stays named in the same fragment.
- Regenerate the assets manifest; refresh this repo's project rules files (`lore context refresh`; the CLAUDE.md half may still refuse per #175 — the rules files are written independently).

Out of scope: which rules are always-loaded (owned by the landed spec above), frontmatter/audience changes, user-layer fragments, skills.

## Acceptance Criteria

Declared with `lore ac add` (AC-RW-1 .. AC-RW-5).

## Risks

- Shortening can drop a constraint hidden in an explanation. AC-RW-3 guards commands mechanically; AC-RW-5 (ai rubric) judges rule preservation per bullet against the verbatim snapshot, and must be evaluated before the plan archives.

## Revisions

Every in-flight change to a criterion, with the original, the failure it produced, and why it corrects rather than weakens. Each was applied with `lore ac set --correction`, whose reason text is stored on the criterion.

| # | Criterion | Original | Failure | Change and why |
|---|---|---|---|---|
| 1 | AC-RW-1..4 | commands began `cd /Users/apple/Projects/zz/lore &&` | `lore verify --falsify AC-RW-3` measured the unmutated main checkout and exited 0 where 1 was declared (#221) | dropped the cd so lore chooses the execution root; checks unchanged |
| 2 | AC-RW-2 | total <= 10000 B | set before measuring; it forced rule cuts that AC-RW-5 forbids (assessments -1 and -2: 65, 50) | <= 10400 after measuring 10319 B (user decision 2026-10-16: no rule may be lost) |
| 3 | AC-RW-3 | only `lore <verb>` spans survive | could not see lost qualifiers (assessment -3) | also every KEPT/MERGED clause of knowledge-traceability-table-always-loaded-lore-fragments present; strictly stronger |
| 4 | AC-RW-5 | one holistic rubric over ten files | graders kept finding new qualifiers; the only pass was the editing session grading itself, refuted | grade only the DROPPED column, per item, reasoning first, by a grader independent of the editor (Anthropic evaluation guidance, knowledge-compressing-always-loaded-instructions-without-losing) |
| 5 | AC-RW-2 | total <= 10400 B | a preset ceiling contradicts lore-context-optimizer step 5 (measure last, no preset target) | no growth over the 14328 B baseline; achieved size measured and reported |


## Acceptance Criteria (structured)

- [⊘] [script] AC-RW-1: lore fragments check exits 0 and packages/lore/tests/unit/assets-ssot.test.ts passes (Tests N passed): the fragments still form a valid set and the assets manifest is fresh.
  script: test — FILES="assets/context/ac-design.md assets/context/corpus-workflow-0-overview.md assets/context/corpus-workflow-1-feed.md assets/context/corpus-workflow-2-produce.md assets/context/corpus-workflow-3-execute.md assets/context/corpus-workflow-4-close.md assets/context/dispatch-bundle.md assets/context/evidence-attestation.md assets/context/worktree-dispatch.md .lore/context/scoped-oracles-in-worktrees.md"; o=$(mktemp); lore fragments check > "$o" 2>&1; r=$?; bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts > "$o.v" 2>&1; v=$?; tail -1 "$o"; grep -E "Tests " "$o.v"; [ $r -eq 0 ] && [ $v -eq 0 ] && grep -qE "Tests +[0-9]+ passed" "$o.v" && echo "AC-RW-1 PASS: lore fragments check exits 0 and assets-ssot passes (manifest fresh)"
- [⚑] [script] AC-RW-2: The always-loaded project rules (cat .claude/rules/lore-*.md) do not grow over their size at b049f0ab (14328 bytes); the measured total is printed and reported.
  script: other — FILES="assets/context/ac-design.md assets/context/corpus-workflow-0-overview.md assets/context/corpus-workflow-1-feed.md assets/context/corpus-workflow-2-produce.md assets/context/corpus-workflow-3-execute.md assets/context/corpus-workflow-4-close.md assets/context/dispatch-bundle.md assets/context/evidence-attestation.md assets/context/worktree-dispatch.md .lore/context/scoped-oracles-in-worktrees.md"; b=$(cat .claude/rules/lore-*.md | LC_ALL=C wc -c | tr -d ' '); echo "always-loaded project rules: $b B"; [ "$b" -le 14328 ] && echo "AC-RW-2 PASS: always-loaded project rules total $b B (no growth over 14328 at b049f0ab; measured value reported)"
- [⚑] [script] AC-RW-4: No line in the ten fragments matches the extended regex 'measured [0-9]{4}-|\(measured|once sat on|once absorbed|[0-9]+ lines of tests' (dated measurement or incident narrative).
  script: other — FILES="assets/context/ac-design.md assets/context/corpus-workflow-0-overview.md assets/context/corpus-workflow-1-feed.md assets/context/corpus-workflow-2-produce.md assets/context/corpus-workflow-3-execute.md assets/context/corpus-workflow-4-close.md assets/context/dispatch-bundle.md assets/context/evidence-attestation.md assets/context/worktree-dispatch.md .lore/context/scoped-oracles-in-worktrees.md"; ! grep -nE 'measured [0-9]{4}-|\(measured|once sat on|once absorbed|[0-9]+ lines of tests' $FILES && echo "AC-RW-4 PASS: no dated measurement or incident narrative remains in the 10 always-loaded fragments"
- [⚑] [ai] AC-RW-5: Every item the traceability table marks DROPPED is explanation (history, incident, dated measurement, mechanism walkthrough, duplicate, common knowledge), judged per item by a grader independent of the editor.
  ai: Read the traceability table knowledge-traceability-table-always-loaded-lore-fragments. Grade ONLY its DROPPED items. For
- [⚑] [script] AC-RW-3: The traceability table knowledge-traceability-table-always-loaded-lore-fragments covers all ten fragments; every KEPT/MERGED phrase appears (whitespace-normalized) in its fragment; every DROPPED item carries a reason; and every lore command named in a fragment at b049f0ab is still named in it.
  script: other — python3 -c "import json,re,subprocess as s
g=lambda a:s.run(a,capture_output=1,text=1,check=1).stdout
d=json.loads(g(['lore','get','knowledge-traceability-table-always-loaded-lore-fragments','--json']))['data']
T=json.loads(re.search('json\\n(.*?)\\n'+chr(96)*3,d.get('doc',d)['content'],re.S).group(1))
n=lambda x:' '.join(x.split())
E=[i['id'] for i in T if not((i['status']in('KEPT','MERGED')and n(i['phrase'])in n(open(i['file']).read()))or(i['status']=='DROPPED'and i['drop_reason'].strip()))]
F={i['file'] for i in T}
p=re.compile(chr(96)+'(lore [a-z][a-z-]*(?: [a-z][a-z-]*)?)');v=lambda x:set(p.findall(x))
E+=[f+':'+x for f in F for x in v(g(['git','show','b049f0ab:'+f]))-v(open(f).read())]
print(len(T),'items',len(F),'files',E or 'ok');raise SystemExit(E!=[] or len(F)!=10)" && echo 'AC-RW-3 PASS: table covers ten fragments, KEPT/MERGED phrases present, DROPPED reasons given, no lore command lost'

## Code anchors

- assets/context/ac-design.md
- assets/context/corpus-workflow-0-overview.md
- assets/context/corpus-workflow-1-feed.md
- assets/context/corpus-workflow-2-produce.md
- assets/context/corpus-workflow-3-execute.md
- assets/context/corpus-workflow-4-close.md
- assets/context/dispatch-bundle.md
- assets/context/evidence-attestation.md
- assets/context/worktree-dispatch.md
- .lore/context/scoped-oracles-in-worktrees.md
