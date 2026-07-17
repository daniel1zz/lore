# Playwright Compilation — freezing accepted journeys into a regression floor

## Division of labor (do not blur it)

Playwright never performs acceptance. It cannot notice that an empty state is bewildering or that a label lies. What it does better than any agent: run the same journey in seconds, on every CI push, with traces, and assert on data no human sees. So:

- **agent-browser** owns: first acceptance of any journey, UX judgment, intent comparison, anything touching a journey whose UI just changed.
- **Playwright** owns: proving that already-accepted journeys still complete with correct outcomes, on every subsequent change, cheaply.

The compiled suite is a **floor, not a ceiling**: it catches regressions of what was accepted; it says nothing about whether new things are acceptable.

## Eligibility — what gets compiled

Compile a journey when ALL hold:

1. Verdict on the journey was pass (all hard gates) in the latest run
2. P0 or P1 (P2 is not worth the maintenance)
3. Path is stable — the executor completed it without exploratory wandering, and the flow isn't mid-redesign
4. Its success criteria have `api` or `artifact` or deterministic `ui` oracles

Journeys that stay agent-only forever: onboarding comprehension, empty-state quality, anything whose essence is "does a confused human recover" — determinism would fake exactly the judgment that matters.

## How to compile

Source material: the executor's **`trace.jsonl`** (structured actions with `role`+`name`) + the journey YAML's success criteria. Because the trace is structured, compilation is a mechanical translation of typed fields, not an error-prone parse of prose. **See `references/probe-and-compile-example.md` Example B for a full trace→spec worked example** — follow it rather than improvising. This layer is **experimental** until one end-to-end compile-and-green-run is demonstrated for the target project; say so in the report.

1. **Locators stay user-shaped.** `getByRole('button', { name: 'Checkout' })`, `getByLabel('Shipping address')` — the same affordances the persona used. If a step can only be located via CSS/test-id, that's a signal the UI element has no accessible name — file it as an accessibility finding AND use the test-id with a comment linking the finding.
2. **Assert business outcomes, not UI mood.** Every `success_criteria` entry becomes an assertion via its oracle: `api` → `request` context asserting the created record's fields; `artifact` → download and parse; `ui` → assert on the *second* surface (list page, detail page), not the toast.
3. **One spec file per journey**, named `J-<id>-<slug>.spec.ts`, tagged `@acceptance-smoke`. Header comment links back to the journey YAML — the YAML is the source of truth; the spec is compiled output.
4. **Test data**: each spec seeds and cleans its own data (API-level setup, UI-level exercise). Never depend on leftovers from another spec.
5. Config: `trace: 'retain-on-failure'`, `video: 'retain-on-failure'` — failures arrive with evidence attached.

## Escalation protocol — when a compiled spec fails

A red acceptance-smoke spec is a claim that an accepted journey broke. Do NOT silently fix the test. Classify first, in this order:

1. **Flake?** Re-run once. Still red → not flake.
2. **Semantic recheck.** Dispatch an agent-browser executor with the ORIGINAL persona bundle for that journey. Two outcomes:
   - Executor also fails / hits confusion → **real regression**. File with both the Playwright trace and the fresh semantic evidence; verdict impact as if a P-level journey failed.
   - Executor completes the goal fine via a different path → **intentional redesign**. The product changed, acceptably. Update the journey YAML (path notes), re-run JUDGE on the fresh evidence, recompile the spec. The journey gets re-accepted, not patched.
3. Only after classification does anyone touch the `.spec.ts`.

This bidirectional loop is the payoff of the two-layer design: Playwright watches cheaply, agent-browser judges expensively, and each hands the other exactly the cases it is bad at.

## CI wiring

```bash
npx playwright test --grep @acceptance-smoke
```

Run on PRs touching the product surface. Keep the smoke suite under ~5 minutes; if it grows past that, demote the slowest P1 specs to a nightly run rather than diluting the PR gate.
