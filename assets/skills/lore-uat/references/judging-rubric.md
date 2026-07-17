# Judging Rubric — six dimensions, three hard gates

This file is the **single source of truth for verdict aggregation.** SKILL.md defers here; do not duplicate the rules elsewhere.

## Judge independence — four inputs, one authority

The judge is a separate subagent from the executor and from whoever implemented the product. It is the **sole author of every gate verdict** (the executor rules nothing). It receives four inputs:

1. **Experience log** (`experience.md`) — the persona's subjective account: what they saw, where they got confused. Evidence, not a ruling.
2. **Action trace** (`trace.jsonl`) — the objective record: end state and nav history. This is what makes independence mechanical rather than nominal.
3. **Spec excerpts** — the judge, unlike the executor, SHOULD see the spec; comparing intent vs. delivery is its job.
4. **Its own oracle-probe results** — the judge runs probes itself (needs Bash/Playwright execution capability; if the judge subagent lacks it, run the probe in the main agent and hand the judge the output).

The judge must rule from these inputs, not from any memory of executing (it didn't execute). If evidence is missing, the gate is `UNVERIFIED`, never an assumed pass.

## The three hard gates

A hard gate is `pass` / `fail` / `UNVERIFIED`. `UNVERIFIED` cannot aggregate to a pass. Any `fail` on a P0 journey → overall REJECT (subject to the reproduction rule below).

### H1 — Task completion (ruled from the trace end state)
Read the final steps of `trace.jsonl`: does the objective end state (`result`, `url_after`, and the confirming screenshot) show the goal achieved within the attempt budget? Decide from the trace, **not** from the executor's prose feelings. "Achieved with heavy confusion" passes H1 (confusion lands in D4). Ended in a give-up event, or an end state that only *looks* successful, fails.

**Reproduction rule (kills executor-incompetence false positives):** a P0 H1 `fail` may not drive REJECT until a **second independent executor** (fresh persona bundle, new profile) reproduces it. Both fail → real product failure. They diverge → mark `EXECUTOR-VARIANCE`, do not REJECT on it, and report the inconsistency.

### H2 — Outcome correctness (hard probe, not eyeballing)
This is the gate that kills "green but broken", so it is not a soft preference:

- For a **P0** journey whose success criterion `oracle` is `api` or `artifact`, the judge **MUST run the probe** and assert the real data: the created record's fields, the downloaded file's contents. See `probe-and-compile-example.md` for a runnable probe.
- If no probe is technically possible (no backend, no artifact), H2 for that criterion is `UNVERIFIED` → the journey cannot pass H2 → cannot ACCEPT on that criterion. Say so explicitly.
- An `oracle: ui` criterion is satisfied only by observing the business fact on a **different surface than the one that announced success** (the order in the orders list, not the confirmation toast) — and even then a `ui` oracle does NOT satisfy a P0 H2; P0 outcome-correctness needs a machine probe.

A success toast over wrong data is the most dangerous pass there is; H2 exists to catch exactly it.

### H3 — No-cheat integrity (audited from the nav trace)
Audit `trace.jsonl`'s `url` sequence and actions independently: did any step reach a deep URL, use a format, or take an action that the persona's `knows` whitelist could not have produced? The nav history is the oracle here — not the executor's self-report, which a contaminated executor would simply omit. A cheat found → H3 `fail`, the run is invalid: re-dispatch the journey with a corrected bundle before any verdict.

## The three scored dimensions (1–5)

- **D4 — Friction.** Count backtracks and confusion events from the trace. The "reasonable minimum" step count is defined as the **shortest successful path any executor of this journey actually demonstrated** (do not invent a minimum from implementation knowledge). 5 = direct, no confusion · 3 = detours, self-recovered · 1 = reached essentially by luck.
- **D5 — Error recovery.** From error-scenario journeys: was the message actionable to *this persona*? Was entered data preserved? 5 = graceful, no data loss · 1 = data lost or dead end.
- **D6 — Design-intent fidelity.** Walk the spec claims item by item: delivered as designed / differently / missing. "Differently" is flagged as an intent deviation for a human ruling, never silently blessed.

## Run-level gates — coverage and UIUX

Two conditions are judged once per run (not per journey) but gate the aggregate verdict:

- **Requirement coverage** (input: `journeys/coverage.md`, built in DERIVE Step 7). Clean ACCEPT requires every P0 requirement in the inventory to be covered by ≥1 executed-and-judged journey. Any P0 requirement UNCOVERED or unexecuted → `COVERAGE-GAP` modifier, verdict capped at ACCEPT-WITH-ISSUES. Uncovered P1/P2 requirements are listed in the report but do not cap the verdict — the honesty is the point.
- **UIUX production bar** (input: `evidence/uiux-audit/audit.md` — see `uiux-production-bar.md`). Clean ACCEPT requires the audit to have run with no blocker finding and all six dimensions ≥ 3. Any blocker or a dimension ≤ 2 → `UIUX-BELOW-BAR`, capped at ACCEPT-WITH-ISSUES. Audit never ran → `UIUX-UNAUDITED`, same cap — an unaudited surface is an unverified claim, like an unprobed H2. UIUX findings never REJECT on their own: a surface broken enough to block the task already fails H1 through a journey.

## Verdict aggregation (SSOT)

| Condition | Verdict |
|-----------|---------|
| All P0+P1 hard gates `pass`, all soft scores ≥ 3, no unruled P0 intent deviations, **all P0 requirements covered, UIUX audit ran clean (no blocker, all dimensions ≥ 3)** | **ACCEPT** |
| All P0 hard gates `pass`; P1 hard-gate fails, soft scores < 3, coverage gaps, and/or UIUX below bar exist | **ACCEPT-WITH-ISSUES** |
| Any P0 hard-gate `fail` (reproduced, per H1 rule) | **REJECT** |

Modifiers:
- **Unconfirmed anchor** (reverse-engineered, no human confirmation): a `fail` against an unconfirmed criterion may not be a P0 REJECT; emit `INTENT-DEVIATION (needs human ruling)` and cap the run at ACCEPT-WITH-ISSUES pending confirmation.
- **No-subagent run**: tag the verdict `SELF-VERIFIED (independence not achievable)` and lower confidence (H3 was self-attested).
- **UNVERIFIED H2 on a P0 journey**: the journey cannot be ACCEPTed; surface it as a blocking gap, not a pass.
- **COVERAGE-GAP / UIUX-BELOW-BAR / UIUX-UNAUDITED**: defined above; each caps the run at ACCEPT-WITH-ISSUES and must appear in the report's modifier line.

P2 journeys never change the verdict alone; their findings ride along as issues. Every non-pass finding carries: journey ID, the spec item it traces to, evidence (trace step numbers + screenshots), and a severity — findings without evidence are deleted, not reported.
