---
id: KN-287
type: knowledge
role: knowledge
title: "Retro: eight approving review rounds cannot catch an error the author and reviewer both read from the same drifted doc"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: [false-oracle, review-limits, verification-discipline, dogfood]
parent: PRD-001
---
# Retro: eight approving review rounds cannot catch an error the reviewer and the author both read from the same drifted doc

**Date**: 2026-07-31 · **Context**: authoring `spec-eager-libsql-load-makes-every-command-depend-on-a-healthy`, then executing it T1→T2

## The measurement

The spec pinned `err(STORE_ERROR)` for "sync enabled, credentials missing" in AC-LL-5 and AC-LL-7(c). The actual code returns `VALIDATION_ERROR` (`resolveSyncCredentials`, three return sites; `app.ts` propagates verbatim). The wrong code survived **eight consecutive `lore review` rounds, every one of them `decision=approve`** (0.78 → 0.84), including rounds whose advisories were specifically about AC measurability.

What caught it: T1's RED oracle, on its first run. `Expected: "STORE_ERROR"` / `Received: "VALIDATION_ERROR"`.

## Why review could not catch it

The author (me) wrote `STORE_ERROR` by copying CLAUDE.md's D-007 summary, which read *"credentials missing or TursoStore construction fails → `err(STORE_ERROR)`"* — one bullet conflating two distinct codes. The judge, each round, read the same CLAUDE.md. **Author and reviewer shared the same false premise, so agreement was guaranteed and worthless.** More review rounds cannot fix this: they resample the same corrupted source.

This is distinct from the usual "LLM judge is advisory" caution, which is about the judge being *wrong*. Here the judge was *consistent with its inputs* — the inputs were wrong. The failure is architectural: review compares an artifact against a document; when the document has drifted from the code, review certifies the drift.

**Rule**: a review round is only as good as its ground truth. For any claim about *what the code actually returns/does*, the sole competent oracle is running the code. Reviewing a claim about code against prose describing that code is a tautology check, not a verification. Corollary: when a spec pins a literal that exists in source (an error code, an exit code, a field name, a flag), grep the source for it before the first review round — cheaper than eight rounds plus a task cycle.

## Second finding: "the judge mentioned it, I ranked it minor" was the actual defect

Round 8's advisory said AC-LL-4 "omits the command being invoked ('the run' rather than a named invocation)". I judged it a wording nit and shipped. It was the real thing: `adapters/cli/loader.ts` strips `config.sync` unconditionally, so the invocation I had in mind (`lore status`) can NEVER reach the branch AC-LL-4 tests — the AC was unsatisfiable as written, by any implementation. T1 discovered this and substituted `lore sync push`.

Pattern: advisories about *unspecified* things deserve more weight than advisories about *badly specified* things. An unnamed quantity hides whether it exists at all.

## Third finding: a test title can contradict its own assertion, and nothing catches it

T2 corrected the two assertions to `VALIDATION_ERROR` and wrote careful `reason:` comments explaining why — but left both test titles reading `yields err(STORE_ERROR)`. All tests passed. `-t` selection still worked (it keys on the AC id). Two full attested `lore verify` runs reported green.

`lore assess` caught it, and stated the consequence precisely: from the evidence record alone it was impossible to tell whether the oracle had been edited to pass or the implementation contradicted the spec. A title is read by humans and by anyone auditing the evidence tail; an assertion is read by the runner. **Nothing in the toolchain compares them**, so they drift silently and the drift degrades the evidence trail rather than the test result.

Cheap guard, no new mechanism: when an AC pins a literal, the test *title* should carry that literal too — then a stale title becomes visible in every output tail instead of only in the source.

## Fourth finding (process): the assess→fix→re-attest order matters

The first `lore verify` attestation ran BEFORE the title fix, so `lore assess` correctly reported that the attested green measured a revision that was not the delivered one. Attestation is a snapshot of a specific tree state; any subsequent edit to an oracle file invalidates it. Re-attest after the last edit, not before.

## Also worth keeping

- `lore assess --diff` on a shared checkout: derive the range from the plan's own first task commit AND restrict the paths to the plan's own files. A bare range across a concurrently-committing repo drags unrelated work in; here `--diff-file` with an explicit 6-file `git diff` produced a clean 78/100 with precise gaps, where a wide range would have produced phantom scope drift.
- `ac rm` refuses to remove a criterion that recorded evidence references, naming `--force`. Correct protection. Removing and re-adding under the SAME id keeps the evidence's `ac_ref` resolvable, so the dangling state is confined to the inside of a `&&` chain — but the chain must be a chain, since `set -e` is inert in this shell.
