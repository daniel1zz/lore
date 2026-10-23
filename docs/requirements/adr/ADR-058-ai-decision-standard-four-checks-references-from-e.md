---
id: ADR-058
type: adr
role: decision
title: "AI decision standard: four checks, references from excellent products, checks at milestones"
status: approved
priority: high
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PRD-001
---
# How an AI decision is made and judged

## Context

Lore's early design added many gates, checkpoints and human stop points. The measured inventory is `knowledge-inventory-2026-10-23-checks-gates-human-stop-points` (read-only queries on this repo's corpus, 2026-07-28 .. 2026-10-23). Its key facts:

- A human answered 1 of 442 autonomy decisions; agents made 1856 of 2107 approvals. 35 sampling-audit items, 2 blocking decisions and 95 drafts are waiting with no answer.
- 1237 of 1338 approve-gate denials meant "no judgment recorded yet", not a quality verdict.
- The task-level judge agrees with humans 0.000 of the time (v6, n=30). This measures a broken question, not AI judgment in general. The judge reviewed tasks before they were claimed and rejected every one on `evidence_completeness` (no evidence can exist yet), and humans approved them anyway (issue #195). Its verdict had no reference to judge against. The review defined below differs in two ways: each dimension must cite a reference (check 3), and it runs at a milestone, when the evidence exists.
- Three override classes can never reach their auto threshold by construction (Wilson lower bound at prior 0.5).

Those mechanisms cost time and context and did not raise product quality. The project owner set the standard below on 2026-10-23.

## Decision

The end goal is **high product quality**. Two properties serve it, and every mechanism must serve one of them. They are named Q1 and Q2 so they cannot be confused with the PRD's goal ids:

- **Q1**: the snapshot (corpus + code on main) is always valid and accurate.
- **Q2**: behaviour is auditable, traceable and fed back into self-improvement.

An AI may judge its own work. A self-judgment is trustworthy when it has a reference and enough dimensions, not when a human signs it. A decision is valid when it passes four checks. This applies both to a decision an agent makes on its own and to a milestone review.

1. **Who decides.** A human decides only three kinds of thing:
   - an irreversible, outward-facing action, such as a force push or deleting remote data;
   - input that only a human has, such as credentials, an OTP or the business direction;
   - changing the product goal or loosening the quality floor.

   Everything else is decided by AI and recorded with its basis.

   The **quality floor** is three things: the write-time invariants kept in "Where checks run", the milestone review dimensions in check 4, and the acceptance criteria of approved specs. Loosening it means lowering a threshold, removing one of those invariants or dimensions, or weakening or deleting an AC. Removing a check is not loosening when the check serves neither Q1 nor Q2, or has no recorded real catch and is duplicated by another check.
2. **Serves the goal.** The decision names the product-quality aspect, or the Q1/Q2 property, it protects. A decision point that cannot name one is deleted, because it is deciding for the sake of deciding.
3. **Has a reference.** Every conclusion is checked against a named reference:
   - Internal: spec ACs, test results, type checks, earlier equivalent decisions.
   - External: an excellent product of the same type, or of a different type in the same scenario. Name the product and the specific practice, say why it is the same scenario, and say which difference could invalidate the conclusion. "Industry usually does X" is not a reference.
4. **Enough dimensions.** A milestone review judges each dimension separately, each with its own verdict and basis:
   - correctness against ACs
   - spec conformance
   - regression
   - design necessity
   - snapshot accuracy
   - concurrency safety
   - security

   A dimension that does not apply says "n/a" and why. None is skipped silently.

When all four checks pass, the AI proceeds without a human.

### References for the scheme itself

- Check 1 (who decides) follows Amazon's one-way vs two-way door rule (2015 shareholder letter): reversible decisions are made quickly by whoever is closest, and only irreversible ones go up. It also follows GitHub branch protection, which blocks force-push and deletion and leaves everything else to the author. Difference: our deciders are agents. That is why "loosening the quality floor" is added as a one-way door.
- Checks 3 and 4 (reference plus dimensions, then automatic promotion) follow automated canary analysis (Netflix/Google Kayenta). A candidate is compared against a baseline on several metrics, each metric is judged separately, and promotion is automatic when all pass. The dimension list follows Google's engineering code review guide (design, functionality, complexity, tests, naming, comments, style, documentation). Difference: our candidates include corpus documents, so snapshot accuracy is its own dimension.

### How quality is measured

Human sign-off is not the quality signal. These are:
- escaped defects: issues filed against a landed plan's code or documents within 14 days of plan close;
- rework: tasks reopened or new fix tasks citing a landed plan;
- typecheck and build failures at landing, the only judgment checks that still run per landing; corpus-wide check failures are counted at plan close.

They are counted per plan and reviewed at each plan close. A rising trend tightens the check or dimension that should have caught the defect (Q2 self-improvement). The PRD G9 R2 target (human review load down by at least 70%) is not claimed as met: the unanswered queues show abandoned review, not load reduction with quality held. The target is restated as this escaped-defect measure.

### There is no new technology, only new business

Technical and architectural choices must cite an external reference. "No reference found" means the search is not finished; it is not a licence to invent.

Only business rules, domain concepts and product-specific flows may be new. Even then the decision is split in two:
- the business part is referenced against the spec and its ACs;
- the technical part that implements it still needs an external reference.

The design-necessity dimension asks: which product's which practice does this technical design follow?

### Where checks run, and the references for each choice

- **Write time keeps only cheap, local invariants** that other sessions would consume immediately: schema, lifecycle transition, version CAS, claim and anchor conflict.
  - Reference: database constraints (PostgreSQL CHECK, FOREIGN KEY and UNIQUE) enforced on every write, while CI judges behaviour later.
  - Same scenario: many writers share one store, and a bad row is read at once.
  - Difference: our writers are agents running across worktrees, not transactions. That is why claim and anchor conflict stay at write time.
- **Judgment work runs only at milestones**: the full suite, full corpus scans, AI review and assessment, at phase end, at a batch landing or at plan close.
  - Reference: GitHub merge queue (required checks run once on a queued batch, not on each push) and Nx/Bazel "affected" builds (only what the change touches).
  - Difference: a lore milestone also judges corpus state, so corpus-wide checks run at plan close, not per landing.
- **Operations on N objects run as one batch**: one command, a preview by default, a per-object audit row and a per-object CAS, and one summary table with per-row OK, SKIPPED or FAILED.
  - References: Terraform plan/apply (preview, then apply, with a per-resource result); `kubectl apply` (per-object result, with optimistic concurrency through resourceVersion); bulk issue editing in GitHub and Linear (many items, one reason).
  - Difference: each lore object is also governed by lifecycle gates. A gated row fails alone and does not abort the batch.
- **Every retained check counts its runs and its real catches**, so a check that never catches anything is proposed for removal instead of accumulating.
  - Reference: LaunchDarkly stale-flag insights (a flag unused for a period is proposed for removal) and ESLint `--report-unused-disable-directives`.
  - Observation window: a check is judged "never catches" only after at least 30 days and at least 50 runs, whichever comes later.
  - Difference: removal is proposed, never applied silently. The removal decision is recorded with its basis (run count, catch count, the check that duplicates it) and is re-judged in the next milestone review under design necessity. A removal that loosens the quality floor goes through check 1.

### Relation to the root PRD

This amends PRD G9, R2, which planned to move doc types to `auto` on Wilson-bounded agreement data (§14). Its mechanism is replaced: approval is decided by the four checks at milestones, not by per-doc-type agreement thresholds. Its target is restated as the escaped-defect measure above. G9 R1 (every lifecycle transition audit-traced) is kept and is Q2.

The root PRD was rewritten to its current snapshot together with this ADR (v121): G9 now states this mechanism, §8 carries the escaped-defect metrics, and the Wilson-promotion text and the dangling §13–§22 references are gone. History lives in version history only.

## Consequences

- Gates, hooks, human stop points and context sources that serve neither Q1 nor Q2 are removed, following the verdicts in the inventory doc named above.
- A design review that lacks a reference, or a milestone review that lacks a dimension, does not pass.
- Human input becomes rare and batched, limited to the three kinds in check 1.
