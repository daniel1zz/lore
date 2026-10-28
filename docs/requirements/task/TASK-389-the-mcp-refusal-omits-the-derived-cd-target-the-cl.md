---
id: TASK-389
type: task
role: plan
title: "Evidence precheck: --oracle manual remains an unmarked, self-selected opt-out"
status: draft
priority: medium
created: 2026-08-03
updated: 2026-10-27
tags: []
parent: PRD-001
---
# An unclosed face of the evidence oracle-file precheck

Left named-but-unfixed by `agent:fix-evidence-precheck-cd` on
`task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a` (merged 2026-08-03).

Face 1 (refusal parity on the second tool surface) is dropped: that surface is retired (adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only). Face 2 remains.

## Face 2 — `--oracle manual` is an unmarked, self-selected opt-out from every check

The precheck's own review section named this and the merged task did not address it (correctly
— it was out of that task's scope):

- `--oracle manual` skips the oracle-file precheck entirely.
- Nothing distinguishes a **genuinely manual** check (a human looked at a screen) from a
  **script-shaped command** filed as manual to get past a refusal.
- The choice is made by whoever hit the friction, at the moment of friction — the worst
  possible time to be trusted with it.

This is the escape-hatch pressure the false-refusal defect already demonstrated in the other
direction: a false refusal *pushed* authors toward `manual`. Fixing the false refusal reduced
the pressure but left the hatch unmarked and unmeasured.

⛔ This is a Silence + Opt-in defect, not a correctness bug. Do NOT "fix" it by forbidding
`--oracle manual` — genuinely manual verification is legitimate and must stay expressible.

# Required fix

2. **Face 2**: decide and implement a marking mechanism. Evaluate at least these two, record
   the rejected one:
   - (a) refuse `--oracle manual` when `--command` is script-SHAPED (contains a runner token
     like `vitest`/`bun test`/`tsc`), forcing an explicit override with a reason;
   - (b) accept it but RECORD the shape mismatch on the row (a field, surfaced by
     `lore done`/`lore verify`), so it is auditable rather than prevented.
   Prefer whichever keeps genuinely-manual rows frictionless. ⛔ (a) without an override path
   re-creates the friction that produced the hatch.
3. Whatever is chosen for Face 2 must be visible to `lore done`'s attestation logic or to an
   audit read — an unmarked opt-out that stays unmarked is the defect restated.

Distribution surface: binary-side (`packages/lore/**`).

# Acceptance criteria

- **AC-3** (Face 2) RED first: today a script-shaped `--command` filed as `--oracle manual` is
  accepted with no trace. Show it.
- **AC-4** (Face 2) after the fix, that row is either refused-with-override-path or recorded
  with the mismatch marked — assert the chosen behaviour AND that the marker/refusal is
  reachable by an audit read.
- **AC-5** (Face 2) CONTROL: a genuinely manual row (no runner token in `--command`) is
  UNCHANGED — no new friction, no new field noise. This AC is what prevents the fix from
  punishing the legitimate case.
- **AC-6** the rejected Face-2 candidate is recorded with its reason.
- **AC-7** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection count.
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** Face 2's "script-shaped" test is a proxy for "this was not actually a manual check".
Input satisfying the proxy while violating the property: a human who genuinely ran a test by
hand, watched it, and filed it as manual — the command IS script-shaped and the claim IS
honest. This is why AC-5 exists and why an override path is mandatory rather than optional.
State the residual explicitly in the implementation's JSDoc.

**Silence.** Face 2 is a silence about which checks were skipped: it hides the absence of
evidence rather than the absence of a message.

**Opt-in.** Face 2 IS an opt-in defect: the opt-out exists, is unmarked, and is chosen by the
party with the incentive to choose it. Any fix that leaves the choice unmarked has not
addressed the finding.
