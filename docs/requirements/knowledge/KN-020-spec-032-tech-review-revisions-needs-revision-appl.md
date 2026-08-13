---
id: KN-020
type: knowledge
role: knowledge
title: "SPEC-032 tech review + revisions (needs-revision → applied)"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-08
tags: [spec-032, review]
parent: SPEC-032
---
# SPEC-032 tech-lead review + revisions (2026-07-03)

Reviewer verdict: needs-revision → 6.5/10, all three must-fix were real and are now applied.

## Must-fix applied
1. **Blueprint pass-by-omission**: original §3.2 blueprint declared knowledge only as a root child; live census shows knowledge is 74% under plans / 21% under specs / 5% under prd, and PARENT_TYPE_CONTRACT permits knowledge:[prd,spec,adr,plan,knowledge], adr:[prd,spec]. walkBlueprint only visits modeled positions, so the shorthand blueprint would report false 0-drift. Fixed: blueprint now encodes the full contract; AC-2 pairs positive check with a NEGATIVE oracle (mis-parented doc must raise `misplaced`).
2. **spec_kind defaulting misdescribed**: Zod superRefine cannot inject a default (addIssue only). Split into schema (validate+fail-loud) + service (CorpusService._createImpl materializes the "feature" default).
3. **Dead resolve_mdx param**: CorpusService.get() resolve_mdx is `_opts` (never read), resolved_components never populated. Added as explicit change site + AC-7 prerequisite for the splice ACs.

## Added ACs
- AC-6 evaluateReadiness() pure-fn signature change (parent-spec-status param) gets direct unit test.
- AC-7 revive get() resolve_mdx populates resolved_components.
- AC-2 negative regression (drift detection proven, not pass-by-omission).

## Confirmed sound
- Descending-position splice (resolve() populates non-overlapping position spans).
- SPEC-033 split (dashboard React rendering off shared resolvedComponents) = clean SRP.
- CLAUDE.md-lint split-out justified (different algorithm class).
