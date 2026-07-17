# Execution Protocol — persona-blind journeys via agent-browser

## Why persona-blind

An executor who has read the spec "knows" the hidden URL, the expected date format, which button is wired up. A real user knows none of this. The value of the semantic layer is that the executor gets stuck exactly where a real user gets stuck (failure modes #2, #5).

## The executor is a reporter, never a judge

This is the hard line that makes independence real. The executor emits **observations, confusion events, and a structured action trace** — nothing else. It must NOT write "I achieved the goal", "this passes", or "I gave up" as a *ruling*. Abandonment is reported as an experienced fact ("I tried six ways to delete the task, none worked, so I stopped"), which is data for the judge — not a verdict. The judge, with independent inputs, decides whether that journey passed. If the executor renders verdicts, JUDGE degenerates into rubber-stamping and failure mode #5 survives.

## Dispatch bundle

Each executor subagent receives ONLY:
1. **Persona card** — the `knows` whitelist (the sole product knowledge allowed)
2. **Goal** — the outcome in the persona's words
3. **Entry point** — where this persona realistically starts (not a deep link unless the persona would have one, e.g. from an email)
4. **Credentials** — only if the persona would have them
5. **Evidence directory** — where to write trace + screenshots + experience log
6. **Attempt budget** — in *countable* units (see below)

Forbidden in the bundle: spec text, internal feature names, selectors, URL paths beyond the entry point, any hint where features live.

## Perceiving the page: screenshots for decisions, snapshots only for a11y evidence

Decide what to do next from **screenshots** (`agent-browser screenshot`) — pixels are what a sighted user actually sees. Do NOT drive decisions from the accessibility/DOM snapshot: it exposes `role`/accessible-name/test-id that a real user cannot see, which is a mild developer-knowledge leak and makes runs non-comparable. Use `snapshot` only to *record* accessibility evidence for a finding, never to locate the next action. (The action trace still records `role`+`name` of what you clicked — that is post-hoc labeling of a pixel-chosen target, captured for compilation, not the basis of the decision.)

## The action trace — write it as you go

`evidence/J-<id>/trace.jsonl`, one JSON line per meaningful action:

```json
{"step":1,"intent":"understand what this is","action":"observe","target":null,"url_before":"/","url_after":"/","result":"header 'TaskLite', a notepad emoji, a '+' button. No instructions.","confusion":true}
{"step":2,"intent":"add a task","action":"click","target":{"role":"button","name":"+"},"url_before":"/","url_after":"/","result":"a text input appeared","confusion":false}
```

Why it matters: the judge rules H1 from the **final `result`/`url_after`** (objective end state, not your prose), audits H3 from the **`url` sequence** (did any action jump to a deep URL a real user couldn't reach?), and PERSIST compiles specs from the **`target.role`+`name`** fields. A prose-only log cannot serve these — the trace is mandatory.

## Attempt budget in countable units

An LLM has no wall-clock sense, so never express patience in minutes. Use units the executor can count:
- **Per obstacle**: try every affordance visible to this persona on the current screen; when they are exhausted, record a give-up event and stop. Do not invent affordances a real user couldn't see.
- **Per journey**: a hard stop at N total confusion events or M distinct failed attempts (persona card sets N/M; default N=5, M=8). Reaching the stop is a valid, reportable outcome — not a failure to route around.

A real user re-enters the same form at most 2–3 times. Do not exceed that.

## Concurrency & isolation

- Isolation is by **browser profile/context**, not session name. `--session J-<id>` does NOT isolate `localStorage`/cookies on a shared origin — two parallel journeys on the same origin would bleed client-side state and corrupt both verdicts.
- **Same-origin client-storage apps** (localStorage/IndexedDB, no backend accounts): serialize unless each journey gets a genuinely separate browser profile/context.
- Journeys on **disjoint backend data** (different test accounts) parallelize safely, one profile each.
- Abandon-and-return needs real backgrounding within one journey (close the page, reopen the entry URL in the same profile) — a genuine gap, not just navigating away.

## Lifecycle scenarios — return-user and accumulated-state

- **Return-user** simulates "come back tomorrow": complete (or reach a natural pause in) the first sitting, then **close the browser entirely** and reopen the entry URL in the **same profile** — a new tab is not a return. The persona's `knows` now legitimately includes what they did last sitting ("yesterday I created three tasks"). What the executor reports: was re-entry graceful (still signed in, or an honest re-login)? Is yesterday's data intact, findable, and continuable?
- **Accumulated-state** requires the **main agent to seed realistic aged data before dispatch** (fixtures, API calls, or a seeding script — default 30+ records with varied dates/lengths/states). The executor never seeds mid-journey — seeding is environment preparation, like creating a test account, not a persona action. The persona card honestly reflects the history ("you've used this app for a month; your data is in it") — that familiarity belongs on the `knows` whitelist; the seed's implementation details do not, and H3 still applies to everything the executor does.

## Evidence capture standard

Per journey the evidence dir ends with: `trace.jsonl` (the action trace), `NN-<slug>.png` (screenshot per meaningful step), and `experience.md` (the persona's first-person account of what they saw and felt — observations and confusion, **no verdict**). If it is not in the evidence, it did not happen.

## Honest degradation — no subagents available

If you cannot dispatch separate subagents (you are yourself a subagent, or there is no Agent tool): execute every journey strictly persona-blind and write the full evidence bundle FIRST; then switch to the judge role. But be honest that a single context cannot un-see its own execution — H3 no-cheat becomes self-attestation. Mark the run's verdict `SELF-VERIFIED (independence not achievable)` and lower its confidence. Never present it as clean acceptance.

## Environment safety

Target staging/local; production only with explicit per-run authorization and read-only. Seed test data before dispatch if journeys need it. If no instance is running, start it via the repo's dev/preview script and record the URL first.

## What the executor must never do

Fix/diagnose the product · read source, specs, or API docs mid-journey · retry more than a real user would · soften a confusion event · **render a verdict**.
