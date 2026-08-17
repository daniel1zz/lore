---
id: KN-461
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PLAN-124
links:
  - {id: KN-457, type: supersedes}
---
> ⚠ INVALIDATED 2026-08-17T04:14:45.908Z — superseded by knowledge-handoff-agent-main-orchestrator-106; Superseded by ticket 106: the exclusivity plan is now CLOSED (AC-OX-7 landed with an independently-run falsifier), so 105's NS1/NS2/NS6 are complete; 106 carries the surviving items plus this round's findings

# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 7 next steps = 14 items to account for

## Plan

plan-land-oracle-exclusivity-a-mirror-check-that-can-fail-a

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | AC-OX-6 is GREEN. Fix landed at the MECHANISM ROOT (ExportDocsService.retireDeletedDocMappings), not the script that only deleted files. Verified on the real tree: mirror:export NAMED the KN-025 retirement and the index lost exactly 4 lines | 97 |
| KD2 | Full bun run test GREEN end-to-end (vitest 512 files/8994 pass, bun 2141 pass/0 fail/869s, mirror OK, persisted exit 0) but anchored at 08091dfd while main is now 7ab1d742: a peer merged 1871 lines incl an ARMED ratchet mid-run. Green does NOT cover current main | 96 |
| KD3 | I polluted my own implementer: wrote KN-458 to the live corpus mid-dispatch after forbidding it from exactly that. Its 9 failures were MINE. Reproduces-at-BASE proves only not-caused-by-this-diff, since BASE shares the same live DB. Control: 23/23 green on main after | 97 |
| KD4 | lore done's gate rightly demanded an unfiltered attested pass for a test-file anchor, but its paste-ready fix was lore evidence --result pass, a SELF-REPORT path. The gate's own hint routes the author around the attestation it just enforced | 94 |
| KD5 | AC ids are SPEC-LOCAL but all prose treats them as global: 51 exact ids claimed by more than one live spec, 10 shared prefixes, AC-DOV-1 spans 11. Ticket 104 itself used bare AC-OX-6 for two different criteria. Tooling is fine (verify is plan-scoped); the convention is missing | 96 |
| KD6 | assess scored 84/72/80; both MAJORs MACHINE-VERIFIED TRUE — oracle-lock.test.ts:14-15 says resolveDefaultLockDir is exercised only by a real bun run test, never by that file, and package.json test IS that wrapper. My full run closes the success half; failure-path propagation unverified | 93 |
| KD7 | 18 evidence rows on this plan carry capture_source=runner with NO attestation block — the --capture trap, quantified. Only lore verify rows carry ac_ref plus attestation. All six ACs do hold at least one attested pass | 97 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: DECIDE whether to close plan-land-oracle-exclusivity. All 5 tasks archived and all 6 ACs hold an attested pass, but assess's AC-OX-4 MAJOR is unresolved: no oracle asserts the PRODUCTION lock path resolves to git rev-parse --git-common-dir (the test injects mkdtemp every call), so a per-worktree lock would pass all 7 cases. Do NOT paste lore done's suggested archival command without settling this
- NS2: NS2: The full-suite green is STALE relative to main (verdict at 08091dfd, main at 7ab1d742 after a peer merge of an ARMED ratchet). Re-run bun run test on current main before treating any green as current, and re-run the newly armed anchor-coverage gate against the merged tree
- NS3: NS3: UNCHANGED from ticket 104 — do NOT close plan-land-oracle-executability (01KZN4F66X). Re-verified: 5 records, 0 ready, 5 archived, but phases corpus-cleanup and backlog-and-arm hold ZERO tasks each. Every-child-archived is trivially true of an empty phase. Decompose those two phases first
- NS4: NS4: UNCHANGED — mechanizing the judge-truncation fix needs a spec first. Re-verified SPEC-028 is approved with AC count 0. New evidence this session: assess printed an 11-item truncated manifest AND still scored gaps against files it never saw. Run /lore-design
- NS5: NS5: Mechanize the two findings recorded this session — knowledge-an-ac-id-is-spec-local-but-every-prose-reference (emit spec-qualified AC ids from handoff/assess/ready) and knowledge-a-concurrent-write-silently-invalidates-the-other (stamp verdicts with the HEAD they describe; lore done flags an attested pass whose HEAD is no longer an ancestor). Both need a spec, NOT writable inside a plan
- NS6: NS6: Two BODY-only mirror drifts persist and need lore export-docs --force: docs/requirements/prd/PRD-001-lore-positioning.md and docs/requirements/spec/SPEC-136-oracle-exclusivity-in-a-shared-checkout-a-mirror-c.md. mirror:export reports drift but leaves overwritten 0; they do NOT affect status parity, so AC-OX-6 stays green regardless
- NS7: NS7: Raw readiness, never inferred — exclusivity records 5 ready 0 archived 5; executability 01KZN4F66X records 5 ready 0 archived 5; multi-session-p1 01KZV0A0KC records 9 ready 0 archived 9; anchor-ratchet 01KZQF85CB7MW3Y07ZFAVZJ2SY (a PEER session's plan, NOT mine) records 6 ready 6 archived 0 — code merged at 7ab1d742 but no lore done run, and its worktree agent-a5f06e880e2856da3 is deliberately LEFT IN PLACE
