---
name: lore-uat
description: "Product-level user acceptance testing (UAT) driven by product design intent. Builds a numbered requirement inventory and audits full coverage (every spec promise → journey → verdict, uncovered items block clean ACCEPT), derives real user journeys across session AND lifecycle scenarios (first-time, return-user next day, month-of-data accumulated state, sunset), executes them persona-blind via agent-browser while an independent judge rules every gate against a structured action trace, runs an independent UIUX production-bar audit (visual consistency, responsive, loading/empty/error states, a11y, copy, feedback — below bar blocks clean ACCEPT), then compiles accepted journeys into Playwright regression suites. Use when the user says '验收', 'acceptance', 'UAT', 'accept this product/feature', 'does this actually work for users', 'is this ready to ship', 'validate against the PRD', 'were ALL requirements verified', 'is the UI production quality', '所有需求都验证了吗', or after a feature/plan is marked complete and needs a delivery gate. Also use when the user complains that testing passed but the product still feels broken, or asks whether the product delivers what was designed. NOT for exploratory bug hunting (use lore-dogfood), NOT for writing test suites (use lore-test), NOT for verifying a single code change (use verify)."
---

# Accept — Product Acceptance as a Real User

Acceptance answers one question: **did we ship what the design promised, judged by a user who knows nothing about the implementation?**

| Skill | Question it answers |
|-------|--------------------|
| `verify` | Does this one code change work? |
| `test` | Do we have a test suite that finds bugs? |
| `dogfood` | What bugs/UX issues exist if we explore freely? |
| **`accept`** | **Does the product deliver the designed user value, end to end, to a real user?** |

> **Shared family discipline**: this skill enforces the failure-first verification rules in `../shared/verification-discipline.md` (read it once per run). Acceptance that only walks success paths is decoration — rule 1 (enumerate mandated failures first) and rule 7 (name what you did NOT cover) are load-bearing here.

## Why AI acceptance falls "10 km short" — the eight failure modes

Every mechanism below exists to *enforce* (not merely suggest) a defense against one of these. If a step is advisory, it does not count as a defense.

| # | Failure mode | Countermeasure — and where it is *enforced* |
|---|-------------|---------------------------------------------|
| 1 | **Reachability ≠ achievement** | Success criteria are business outcomes; the judge rules H1 from the **action trace's end state**, not a success toast (DERIVE, JUDGE) |
| 2 | **Developer-knowledge cheating** | Persona-blind executor gets a knowledge whitelist only; the judge audits the **nav trace** for cheats (EXECUTE, JUDGE/H3) |
| 3 | **Weak pass bar** | H2 outcome-correctness is a **hard probe**, not eyeballing — no probe possible ⇒ `UNVERIFIED`, which cannot pass (JUDGE) |
| 4 | **Happy-path-only** | Four non-happy scenarios are **mandatory** per P0 goal (DERIVE) |
| 5 | **Self-verification paradox** | Executor and judge are **separate roles with separate inputs**; the executor never renders a verdict (EXECUTE, JUDGE) |
| 6 | **Spec-sampling illusion** — "we accepted the product" silently means "we accepted the journeys we thought of" | A numbered **requirement inventory** is built before derivation and reverse-audited into a coverage matrix; a P0 requirement left uncovered blocks clean ACCEPT (DERIVE, REPORT) |
| 7 | **Day-one-only acceptance** — the product only ever meets a brand-new user in a single sitting | **Lifecycle scenarios** are mandatory per P0 goal: return-user (come back tomorrow, data intact and continuable) and accumulated-state (core flow still usable under a month's worth of real data) (DERIVE, EXECUTE) |
| 8 | **Works ≠ shippable** — functional pass mistaken for production quality | An **independent UIUX audit** (third role) scores the whole surface on six production-bar dimensions; a blocker or a dimension ≤ 2 blocks clean ACCEPT (AUDIT) |

## The role split — the spine of the whole skill

The single most important rule: **the executor reports, the judge rules.** They are different cognitive layers, not two passes of the same judgment.

- **Executor (phenomenological reporter).** Lives a journey as the persona. Emits only: what it saw, what it did, where it got confused, and a **structured action trace**. It NEVER writes "I achieved the goal" or "I gave up as a verdict" — confusion and abandonment are reported as *experienced events* ("I could not find a way to delete, so I stopped trying"), never as a pass/fail ruling.
- **Judge (sole verdict authority).** Never drove the journey. Receives four independent inputs — the experience log, the **action trace** (objective end-state + nav history), the spec, and **oracle-probe results it runs itself** — and renders every gate. Because H1 is decided from the trace's end state (not the executor's prose) and H3 from the nav history (not the executor's self-report), the independence is mechanical, not nominal.
- **UIUX auditor (production-bar reviewer).** A third role, run once per acceptance run: an expert design reviewer (not persona-blind — the audit is not behavioral) who reads every journey's screenshots, revisits key screens at multiple viewports and states, and scores six quality dimensions. It rules no hard gates; its findings gate clean ACCEPT through the aggregation SSOT. See `references/uiux-production-bar.md`.

If you cannot run separate subagents, see the honest-degradation rule in `references/execution-protocol.md` — you must mark the verdict `SELF-VERIFIED (independence not achievable)` and cap its confidence. Do not present a self-graded run as clean acceptance.

## The structured action trace

Every executor writes `evidence/J-<id>/trace.jsonl`, one line per action:

```json
{"step":3,"intent":"add my first task","action":"click","target":{"role":"button","name":"+"},"url_before":"/","url_after":"/","result":"an input field appeared","confusion":false}
```

This trace is the skill's backbone: it is the judge's objective input for H1 (end state) and H3 (was any deep URL reached without a persona-plausible path?), and the mechanical source for Playwright compilation (`role`+`name` map straight to `getByRole`). Prose logs alone cannot serve any of these — capture the trace.

## Two-layer architecture

**Semantic layer — agent-browser.** Role-plays a persona, adapts to an unexpected UI, and treats *"as this persona I don't know what to do next"* as a finding. Performs all first-time acceptance, UX judgment, and design-intent comparison. Always invoke `agent-browser` directly (fast Rust client), never `npx agent-browser`.

**Mechanical layer — Playwright.** Deterministic, CI-native, asserts on network/data no human sees. Never performs acceptance — it freezes already-accepted journeys into a regression floor. See `references/playwright-compilation.md` (and note it is **experimental** until one end-to-end compile-and-green-run is demonstrated for the target project).

The layers feed each other: the executor's action trace compiles into specs; a failing spec escalates back to an agent-browser semantic recheck (never a silent test patch).

## The seven phases — executed in priority tiers, not one big batch

Run the loop **tier by tier: all P0 journeys first, then P1, then P2.** Within a tier, each journey goes EXECUTE → JUDGE → append-verdict before the next. Checkpoint `report.md` after each tier completes. This ordering is a hard requirement: a long run can die (crash, budget, timeout), and tier-checkpointing guarantees the highest-value verdicts survive. Never batch all executions and defer all judging — that is exactly how the first real run lost every verdict.

```
ANCHOR → DERIVE → [ for tier in P0,P1,P2:  for journey in tier:  EXECUTE → JUDGE → append verdict ] → checkpoint → AUDIT → REPORT → PERSIST
```

Create a todo per phase. Read each phase's reference file when you reach it.

### 1. ANCHOR — establish designed intent
Collect the anchor, in priority order: (1) lore PRD/feature-spec (`lore search "<feature>" --type prd --json`, `lore get <slug> --resolve-mdx`, `lore ac list <spec>`); (2) repo `docs/` PRDs/specs; (3) **neither exists** → reverse-engineer a user model from the product, and treat every reconstructed criterion as **UNCONFIRMED**. Present it to the user for confirmation; **if no user is available (headless), proceed but carry the UNCONFIRMED flag forward** — a verdict against an unconfirmed criterion may never be a P0 hard REJECT; the worst it yields is `INTENT-DEVIATION (needs human ruling)`. Suggest `/product` for a real anchor next time.

Establish the **target environment**: staging/local URL (never production without explicit authorization). **If no instance is running, start it first** via the repo's dev/preview script and record the URL before DERIVE.

### 2. DERIVE — requirement inventory, Journey Matrix, coverage audit
Read `references/journey-derivation.md`. First build the **requirement inventory** (`journeys/requirements.yaml` — every user-facing commitment as a numbered R-## item); it is the denominator of the whole run. **Mandated rejections are requirements too**: everything the product must REFUSE (invalid input → clear error, missing permission → denial, destructive action → confirmation, quota/limit → block) is inventoried as first-class `R-NEG-##` rows, derived from the spec's constraints and error contracts — they enter the same coverage matrix, and an UNCOVERED P0 `R-NEG` row blocks clean ACCEPT exactly like a happy-path row (shared discipline rule 1: a product accepted only on what it does, never on what it refuses, is unverified). Then output `journeys/*.yaml` (template: `templates/journey.yaml`) with persona, goal, entry point, and **business-outcome success criteria** (never UI states). Priority classes: **P0** core-value (any P0 hard-gate fail → REJECT), **P1** supporting, **P2** edge. Mandatory per P0 goal: the four session scenarios (first-time/empty-state, error-recovery, abandon-and-return, real-world-messy-input) **plus two lifecycle scenarios** (return-user, accumulated-state — seed data before dispatch); sunset scenarios in thorough tier. Close with the **coverage audit** (`journeys/coverage.md`): every requirement maps to journeys or is explicitly UNCOVERED with a reason — a P0 requirement may never be UNCOVERED.

Respect the **budget tier** (quick / standard / thorough — see the reference's table) so journey count and concurrency stay bounded. If a Journey Ledger exists, diff against the spec instead of re-deriving.

### 3. EXECUTE — persona-blind via agent-browser
Read `references/execution-protocol.md`. Dispatch one executor per journey with ONLY the persona whitelist, goal, entry URL, and credentials-if-the-persona-would-have-them — never spec text, feature names, selectors, or deep paths. The executor drives agent-browser, decides from **screenshots** (pixels — what a sighted user sees), writes the **action trace** + a confusion-annotated experience log, and renders **no verdict**. Concurrency isolation is by **browser profile/context**, not session name; same-origin client-storage apps serialize unless profile-isolated.

### 4. JUDGE — the sole verdict authority
Read `references/judging-rubric.md`. A separate judge receives the experience log, the action trace, the spec, and runs its **own oracle probes**. Hard gates: **H1** task completion (from trace end state), **H2** outcome correctness (**must** run the api/artifact probe for P0; no probe ⇒ `UNVERIFIED` ⇒ cannot pass), **H3** no-cheat (audit the nav trace). Scored 1–5: friction, error-recovery, design-intent fidelity. A **P0 H1 failure requires a second independent executor to reproduce** before it can drive REJECT (distinguishes product failure from executor incompetence).

### 5. AUDIT — UIUX production bar (independent, run-level)
Read `references/uiux-production-bar.md`. After the last executed tier is judged, dispatch the **UIUX auditor**: it reads all journey screenshots/traces, revisits key screens at mobile + desktop viewports and in empty/loaded/error states, scores six dimensions (visual consistency, responsive integrity, state completeness, a11y baseline, copy quality, interaction feedback), and writes `evidence/uiux-audit/audit.md`. This phase is required — a skipped audit caps the verdict (`UIUX-UNAUDITED`), the same way an unprobed H2 cannot pass.

### 6. REPORT — verdict with traceable evidence
Verdict is authored **incrementally**: append each journey's verdict block to `report.md` the moment JUDGE finishes it. Aggregation rules live **only** in `references/judging-rubric.md` (single source of truth) — three values: ACCEPT / ACCEPT-WITH-ISSUES / REJECT, gated additionally by the run-level coverage and UIUX rules. The report must answer three whole-run questions explicitly: which requirements were verified and with what verdict (the completed coverage matrix), which lifecycle stages ran, and where the surface sits against the production bar. Every gap traces to a spec item + evidence (trace steps + screenshots), formatted to drop straight into `/to-issues` or `diagnose`. Fill `templates/acceptance-report.md`.

### 7. PERSIST — durable assets
Read `references/playwright-compilation.md`. (1) Commit the Journey Ledger. (2) Compile eligible accepted journeys from their **action traces** into Playwright smoke specs (user-facing locators + api-level outcome assertions). (3) Write the **structured** verdict back to the lore corpus if the project is lore-managed (SPEC-054): `lore uat record <plan-slug> --json-file <verdict.json>` where `verdict.json` matches `uatVerdictSchema` (`{verdict: "accept"|"reject"|"accept_with_conditions", tier_results: [{tier:"P0"|"P1"|"P2", accepted, rejected, unverified}], requirement_coverage: {total, covered, uncovered_p0: []}, uiux: {blocker_count, min_dimension_score}, run_meta: {at, by, degraded?}}`). This creates a `knowledge`/`uat` doc + an `informs` link to the plan; the `plan-close` gate reads it (a plan declaring `extra.requires_uat: true` cannot be archived until its latest verdict shows P0 acceptance — verdict not "reject", no rejected P0 journey, no uncovered P0 requirement, no UIUX blocker). Do NOT hand-write a free-text `knowledge --sub-type retro` for the verdict — direct `lore create knowledge --sub-type uat` is rejected (writer-identity guard); `lore uat record` is the sole write path.

## Output layout
```
acceptance-output/
├── report.md                  # incrementally-appended verdicts
├── journeys/
│   ├── requirements.yaml      # numbered R-## inventory — the run's denominator
│   ├── coverage.md            # requirement → journey matrix, UNCOVERED rows carry reasons
│   └── J-<id>-<slug>.yaml
├── evidence/J-<id>/           # trace.jsonl + screenshots + experience log
├── evidence/uiux-audit/       # audit.md + multi-viewport/state captures
└── regression/*.spec.ts       # compiled Playwright smoke specs
```

## Reference files
| File | Read when |
|------|-----------|
| `references/journey-derivation.md` | Entering DERIVE |
| `references/execution-protocol.md` | Entering EXECUTE |
| `references/judging-rubric.md` | Entering JUDGE / REPORT (verdict-aggregation SSOT) |
| `references/uiux-production-bar.md` | Entering AUDIT (the UIUX auditor's full protocol) |
| `references/probe-and-compile-example.md` | Writing an H2 oracle probe (JUDGE) or compiling a spec (PERSIST) |
| `references/playwright-compilation.md` | Entering PERSIST, or when a regression spec fails |
| `references/drivers.md` | Target is not a desktop web app |
