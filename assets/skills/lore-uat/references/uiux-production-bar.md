# UIUX Production Bar — the independent quality audit

A journey can pass every hard gate and still not be shippable: misaligned cards, three different button styles, a mobile layout that overflows, forms with no loading feedback. Functional acceptance answers "does it work"; this audit answers "would a user believe this is a finished product" (failure mode #8: works ≠ shippable). Neither substitutes for the other.

## The auditor — third role, different contract

The **UIUX auditor** is a separate subagent from every executor and from the judge. Its contract differs from both:

- Unlike the executor, it is **not persona-blind** — it is an expert design reviewer with full knowledge of what screens exist (it learns them from the traces). Persona-blindness protects behavioral realism; the audit is not behavioral, so the constraint does not apply.
- Unlike the judge, it rules **no hard gates** — H1/H2/H3 remain the judge's monopoly. The auditor's output is dimension scores + findings; how those affect the verdict is decided only by the aggregation SSOT in `judging-rubric.md`.
- Like both, it is evidence-bound: a finding with no screenshot reference is deleted, not reported.

Why a single global auditor instead of a per-journey dimension in the judge: consistency defects are *relations between screens* — the settings page using a different button style than the dashboard, two spacing systems on adjacent views. A per-journey judge sees one journey's screens and can never see the relation. The auditor reads the whole product surface at once.

## When it runs

Once per acceptance run, after the last executed tier is judged and before the final report is assembled. It is a **required phase**: if the audit did not run (budget death, missing capability), the run cannot cleanly ACCEPT — the verdict carries `UIUX-UNAUDITED` (see aggregation SSOT). An unaudited surface is an unverified claim, exactly like an unprobed H2.

## Inputs

1. **All journey evidence** — every `evidence/J-*/` screenshot and `trace.jsonl`. The traces give the auditor the map: which URLs exist, which screens the journeys reached.
2. **Its own supplementary captures** — the auditor drives agent-browser itself (fresh profile) to revisit key screens at multiple viewports and states. Journey screenshots are single-viewport by persona; the audit must not be.
3. **The anchor's non-functional promises** — any inventory requirement (R-##) about device support, performance feel, or brand/design language becomes an explicit check.

Supplementary capture protocol:
- Viewports: **375×812 (mobile)** and **1280×800 (desktop)** minimum; add the spec's declared breakpoints if any.
- States: for each key screen, capture what the journeys may have skipped — empty (fresh account), loaded (use the accumulated-state seed), error (offline or an invalid submit), and loading if it can be caught.
- The auditor may use accessibility snapshots freely (`agent-browser snapshot`) — the executor's pixels-only rule exists to protect persona realism and does not bind the auditor.

## The six dimensions

Score each 1–5 across the whole product surface. 5 = indistinguishable from a polished commercial product · 3 = shippable with known cosmetic debt · 1 = visibly unfinished.

| # | Dimension | What to check |
|---|-----------|---------------|
| U1 | **Visual consistency** | One spacing rhythm, one type scale, one color vocabulary across screens. Same action → same component style everywhere. Alignment: nothing visibly off-grid |
| U2 | **Responsive integrity** | At each viewport: no horizontal overflow, no clipped/overlapping elements, touch targets usable on mobile, layout *reflows* rather than shrinks |
| U3 | **State completeness** | Every data surface has designed loading, empty, and error states. Empty states guide ("create your first…"), never blank. No layout jump when data arrives. No raw exception text or `undefined`/`NaN` reaching pixels |
| U4 | **Accessibility baseline** | Text contrast ≥ 4.5:1 (spot-check the worst pairs), visible focus indicators, keyboard path through the P0 flow, interactive elements have accessible names (from snapshot), images/icons carrying meaning have labels |
| U5 | **Copy quality** | Language a real persona understands — no developer jargon, no placeholder text (`lorem`, `TODO`, `test123`), no untranslated fragments in a localized product, error messages say what to *do* |
| U6 | **Interaction feedback** | Every action acknowledges within a perceptible instant (pressed states, spinners), destructive actions confirm, double-submit is guarded, transitions don't strand the user |

D4 (friction) already punishes *confusing* flows journey-by-journey; U1–U6 judge the *craft* of the surface. Overlap is fine — the two catch different failure classes.

## Findings and severity

Each finding: dimension, screen(s), severity, evidence (screenshot filename — journey evidence or the auditor's own captures under `evidence/uiux-audit/`).

- **blocker** — a user would judge the product broken or amateur: unreadable text, broken mobile layout on a P0 screen, raw error dumps, dead-looking buttons on the core flow
- **major** — visibly unpolished but usable: inconsistent components, jarring layout shifts, unhelpful empty states
- **minor** — polish debt: slightly-off spacing, tone inconsistencies

## Output

`evidence/uiux-audit/audit.md`: the U1–U6 score table (each score with a one-line justification + evidence refs), the findings list, and the supplementary screenshots alongside. The REPORT phase copies the score table and blocker/major findings into the acceptance report.

## Effect on the verdict (summary — SSOT is judging-rubric.md)

UIUX findings never REJECT a run on their own — a surface so broken it prevents task completion already fails H1 through a journey. What they do is **block clean ACCEPT**: any blocker finding, or any dimension scoring ≤ 2, caps the run at ACCEPT-WITH-ISSUES with the `UIUX-BELOW-BAR` modifier. Production quality is part of what "accepted" means, not an optional annex.
