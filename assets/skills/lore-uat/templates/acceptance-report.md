# Acceptance Report — {PRODUCT / FEATURE}

| | |
|---|---|
| **Verdict** | ACCEPT / ACCEPT-WITH-ISSUES / REJECT |
| **Verdict modifiers** | {none · SELF-VERIFIED (no independent judge) · anchor UNCONFIRMED · has UNVERIFIED-H2 gaps · COVERAGE-GAP · UIUX-BELOW-BAR · UIUX-UNAUDITED} |
| **Requirement coverage** | {n}/{total} verified (P0: {n}/{n} — must be full) · {n} UNCOVERED (listed below) |
| **UIUX production bar** | U1–U6: {5/4/3/…} · {n} blocker · {n} major · or "NOT RUN — verdict capped" |
| **Date** | {YYYY-MM-DD} |
| **Anchor** | {PRD/spec doc ids · or "reconstructed user model — CONFIRMED / UNCONFIRMED"} |
| **Environment** | {staging/local URL} |
| **Journeys executed** | {n} (P0: {n} · P1: {n} · P2: {n}) · run tier: {quick/standard/thorough} |
| **Independence** | {separate judge subagent · or SELF-VERIFIED} |
| **Regression floor** | {n} journeys compiled to Playwright (experimental until first green run) / n/a |

## Verdict rationale

{2–4 sentences: which hard gates drove the verdict. If REJECT, name the failing P0 journeys plainly.}

## Requirement coverage matrix

<!-- Copied from journeys/coverage.md with the post-judging verdict column filled.
     This table answers "were ALL the promises verified" — every R-## appears, covered or not. -->

| Req | Severity | Statement | Covered by | Verdict |
|-----|----------|-----------|------------|---------|
| R-01 | P0 | {user outcome} | J-001, J-003 | pass |
| R-09 | P1 | {user outcome} | — | UNCOVERED: {honest reason} |

## Journey results

| ID | Journey | Pri | Scenario | H1 done | H2 correct | H3 no-cheat | Friction | Recovery | Fidelity | Result |
|----|---------|-----|----------|---------|------------|-------------|----------|----------|----------|--------|
| J-001 | {slug} | P0 | {happy/…/return-user/accumulated-state} | ✅/❌ | ✅/❌ | ✅/❌ | {1–5} | {1–5}/– | {1–5} | pass/fail |

Lifecycle stages executed: {first-time ✅ · return-user ✅ · accumulated-state ✅ · sunset —/tier}

## UIUX production bar (from evidence/uiux-audit/audit.md)

| U1 Visual | U2 Responsive | U3 States | U4 A11y | U5 Copy | U6 Feedback |
|-----------|---------------|-----------|---------|---------|-------------|
| {1–5} | {1–5} | {1–5} | {1–5} | {1–5} | {1–5} |

{Blocker/major findings, one line each, with evidence refs — minors stay in audit.md}

## Findings

<!-- One block per finding, severity order. Every finding traces to spec + evidence; no evidence → no finding. -->

### F-1 · {severity: blocker/major/minor} · {one-line statement}

- **Journey**: J-00x · **Spec item**: {PRD §…}
- **What the user experienced**: {in persona terms — what they wanted, where it broke}
- **Evidence**: `evidence/J-00x/steps.md` steps {n–m}, screenshots `{NN-slug.png}`
- **Hard-gate impact**: {H1/H2/H3 fail, or soft-score driver}

## Intent deviations (delivered ≠ designed, needs human ruling)

| Journey | Spec said | Product does | Judge's note |
|---------|-----------|--------------|--------------|

## Assets persisted

- Journey Ledger: `journeys/` ({n} active, {n} new, {n} retired)
- Compiled regression: `regression/*.spec.ts` ({n} specs, tag `@acceptance-smoke`)
- {lore write-back slug (knowledge retro doc), if lore-managed}

## Handoff

{Which findings should go to /to-issues or diagnose; which journeys to re-run after fixes — the re-acceptance scope.}
