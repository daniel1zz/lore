---
id: TASK-321
type: task
role: plan
title: "Build the spec-mirror export script, wire it into the root chain, and add a drift check that is a separate command from the exporter"
status: archived
priority: medium
phase: "mirror"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-076
plan: PLAN-076
---
Build the spec-mirror export script, wire it into the root script chain, and add a drift check that
is a SEPARATE command from the exporter.

⛔ Measured baseline: root CLAUDE.md tells readers "exported mirrors live under
`docs/requirements/spec/`". That directory held 100 files against 141 corpus specs — 41 absent, 29%
drift — and root `package.json` has NO export script at all, so nothing regenerates it and nothing
detects the divergence. Re-measure both numbers yourself at the start; do not carry these forward as
literals (a count typed into a document is a claim with no oracle — read them from
`lore list --type spec --json` and the filesystem).

Deliver:

1. **An idempotent export script** under `scripts/`, following the existing `scripts/check-*.ts`
   conventions in this repo.
2. **Chain wiring in root `package.json`** — the script must be reachable from a script chain, not
   merely present. ⛔ AC-FR-6 asserts chain membership explicitly because this repo has already
   shipped a tsconfig project that existed but was never invoked; the oracle that only interrogated
   the project directly stayed green while the blind spot reopened.
3. **A drift check as a SEPARATE command** (D6). ⛔ A check that regenerates what it is checking can
   never fail. Run-twice must report the same drift both times.

## Non-negotiable oracle shape

- ⛔ AC-FR-6 asserts parity against the **LIVE corpus count**, never a literal in the test.
- ⛔ AC-FR-7 asserts the drift check exits **EXACTLY** the documented non-zero code and its output
  NAMES the missing slug. Asserting merely "non-zero" is unacceptable — a check that crashes before
  inspecting anything also exits non-zero and has zero discriminating power. This is this repo's
  most-repeated false-oracle vector.
- Record BOTH reds for each AC, live: for AC-FR-6, (a) remove the script from the chain, (b) delete
  one exported file; for AC-FR-7, make the check call the exporter first and show the second run
  reports clean — that must FAIL the AC.

## Scope caution

Exporting 141 specs will produce a large diff of generated files. That is expected. ⛔ But do NOT
also "fix" the CLAUDE.md sentence that describes the mirror, or any other doc, unless your own change
makes it false — and if it does, say so explicitly in your report rather than editing silently.
