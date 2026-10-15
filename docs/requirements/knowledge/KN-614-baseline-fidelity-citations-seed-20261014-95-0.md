---
id: KN-614
type: knowledge
role: knowledge
title: "Baseline fidelity (citations) seed 20261014: 95.0% faithful"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
---
# Baseline fidelity sample (citations, seed 20261014)

95.0% of 20 sampled citations judged faithful (pool 386, 2 judge(s), 1 disagreement(s)).

## Record
```json
{
  "mode": "citations",
  "seed": 20261014,
  "size": 20,
  "pool": 386,
  "judges": 2,
  "verdicts": [
    {
      "n": 1,
      "key": "spec-an-escalate-blocks-approval-for-every-doc-type-and-the#AC-ESC-2->BR-281",
      "verdict": "faithful",
      "reason": "The test checks that a reject on an ungated type still lets approval succeed, which is the rule's central claim."
    },
    {
      "n": 2,
      "key": "spec-079-audit-hardening-link-provenance-actor-fidelity-tamper#AC-079-1->BR-757",
      "verdict": "faithful",
      "reason": "The suite checks that every link call writes exactly one audit entry in the documented shape, which matches the rule's one-entry-per-link audit claim."
    },
    {
      "n": 3,
      "key": "spec-context-fragments-config-driven-layered-rule-injection#AC-CF-3->BR-907",
      "verdict": "faithful",
      "reason": "The boundary tests at exactly the limit and one character over, with BUDGET_EXCEEDED naming each fragment and its size, directly exercise the rule's limit semantics."
    },
    {
      "n": 4,
      "key": "spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start#AC-070-5->BR-597",
      "verdict": "faithful",
      "reason": "The criterion checks the claim-state section and the explicit none-lines for empty sections, both of which the rule requires of the task-start pack."
    },
    {
      "n": 5,
      "key": "spec-falsifiability-reachability-a-feedable-checkpoint-an#AC-FR-12->BR-189",
      "verdict": "faithful",
      "reason": "A control that cannot run leading to a persisted inconclusive row with no attestation and exit code 3 is exactly the rule's claim."
    },
    {
      "n": 6,
      "key": "spec-lore-assess-project-evidence-rows-instead-of-embedding-the#AC-AEP-8->BR-547",
      "verdict": "faithful",
      "reason": "The regression asserts that full truncation forces an inconclusive verdict with no score and that the confidence downgrade still applies, as the rule states."
    },
    {
      "n": 7,
      "key": "spec-084-corpus-allocated-ordinal-identity-store-atomic-spec#AC-084-3->BR-9",
      "verdict": "not_faithful",
      "reason": "The criterion tests ordinal auto-allocation, title rejection and resolution, but never checks the rule's distinguishing claims that a domain overview gets no number and that numbering skips it."
    },
    {
      "n": 8,
      "key": "spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles#AC-SL-4->BR-340",
      "verdict": "faithful",
      "reason": "The criterion checks that creating a handoff through ordinary create fails with a validation error naming lore handoff, on the service, MCP and CLI routes, which matches the rule."
    },
    {
      "n": 9,
      "key": "spec-context-fragments-config-driven-layered-rule-injection#AC-CF-4->BR-914",
      "verdict": "faithful",
      "reason": "The check fails on rules files that are missing, extra or different from a fresh render and on oversized fragments, which matches what the rule says check reports."
    },
    {
      "n": 10,
      "key": "spec-a-write-side-fact-with-no-read-side-address-counts-with-no#AC-RR-5->BR-746",
      "verdict": "faithful",
      "reason": "The criterion shows that the sub-type filter returns only retros and that limit/offset paginate the filtered set, which matches the rule and its example."
    },
    {
      "n": 11,
      "key": "spec-issue-closure-loop-computed-resolution-agent-reachable#AC-ICL-10->BR-508",
      "verdict": "faithful",
      "reason": "The criterion checks that a closed issue is left out by --open and included by --resolved, which tests BR-508's split between unfinished and finished reports, even though it doesn't cover the rule's switch-exclusivity or empty-result parts."
    },
    {
      "n": 12,
      "key": "spec-spec-060-lore-setup-project-scaffold-completion-repo-level#AC-060-1->BR-834",
      "verdict": "faithful",
      "reason": "The manifest entries must equal exactly the set of files written, which matches the rule's ledger of exactly the written files."
    },
    {
      "n": 13,
      "key": "spec-spec-044-memory-hygiene-part-2-staleness-probes-h2#AC-SP-6->BR-469",
      "verdict": "faithful",
      "reason": "The criterion checks that --staleness --list makes no provider call and drops a listed document once it is edited, which matches the rule."
    },
    {
      "n": 14,
      "key": "spec-resume-coverage-floor-the-satisfaction-boundaries-a#AC-RCS-4->BR-359",
      "verdict": "faithful",
      "reason": "The criterion checks that a deferral naming no destination leaves the item open with a distinct refusal prefix, and that an issue reference or slug closes it, which is exactly the rule."
    },
    {
      "n": 15,
      "key": "spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3#AC-DR-4->BR-438",
      "verdict": "faithful",
      "reason": "The composed --check-drift --check-tree exit, with drift's 3 taking precedence over the tree check's 4, exercises the rule's exit-code precedence."
    },
    {
      "n": 16,
      "key": "spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3#AC-DR-4->BR-441",
      "verdict": "faithful",
      "reason": "Plain lore status showing a store-only armed count with zero probing matches the rule that the plain report counts anchors without reading files."
    },
    {
      "n": 17,
      "key": "spec-a-github-filed-defect-must-be-claimable-one-ingest-seam#AC-GR-9->BR-495",
      "verdict": "faithful",
      "reason": "Filing an issue and then claiming the derived slug with no extra step directly verifies the rule's claimable-at-once claim."
    },
    {
      "n": 18,
      "key": "spec-resume-coverage-floor-the-satisfaction-boundaries-a#AC-RCS-2->BR-362",
      "verdict": "faithful",
      "reason": "The criterion checks that sidechain dispositions do not discharge items while a sidechain-produced ticket still arms, which is the rule's asymmetry."
    },
    {
      "n": 19,
      "key": "spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3#AC-DR-8->BR-415",
      "verdict": "faithful",
      "reason": "A write-counting oracle shows zero store writes, no version bumps and no audit rows on a drifting corpus, exactly as the rule claims."
    },
    {
      "n": 20,
      "key": "spec-spec-042-session-layer-part-2-session-registry-file-anchor#AC-S3-11->BR-132",
      "verdict": "faithful",
      "reason": "Stealing a claim still blocks on an anchor overlap and then succeeds after the conflicting claim is released, which matches the rule and its example."
    }
  ],
  "disagreements": [
    {
      "n": 11,
      "verdicts": [
        "faithful",
        "not_faithful"
      ],
      "adjudicated": "faithful"
    }
  ],
  "faithful_share": 0.95,
  "catch_all": [],
  "threshold_share": 0.05
}
```
