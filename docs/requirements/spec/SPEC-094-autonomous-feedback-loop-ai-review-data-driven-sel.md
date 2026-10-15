---
id: SPEC-094
type: spec
role: spec
title: "Autonomous Feedback Loop (AI review, data-driven self-optimization) (domain overview)"
status: deprecated
priority: medium
created: 2026-07-26
updated: 2026-10-10
tags: []
---
## 14. Autonomous Feedback Loop (AI review, data-driven self-optimization)

**Vision (owner, 2026-07-06)**: Lore closes its own quality loop. AI reviews every lifecycle decision with structured, data-backed feedback; humans are pulled in only when the AI cannot decide; every automated decision is log-traceable; the accumulated decision data drives self-optimization. End state: Lore is not just self-hosting (it already manages its own corpus) but self-running, self-feedback, self-optimizing.

**Today's gap (measured 2026-07-06)**: the loop exists as disconnected parts. `lore pending` holds 12 docs, 100% awaiting manual approval regardless of how confident an AI reviewer would be; SPEC-026 assessments carry structured `gaps`/`recommendations` that no downstream consumer reads; SPEC-025 evidence and SPEC-012 telemetry record locally but aggregate nowhere; approve/reject reasons are free text — feedback is not comparable across time, so nothing can learn from it.

### 14.1 Capability domains

| ID | Domain | What it delivers |
|---|---|---|
| D1 | Structured review judgment | AI reviewer emits a Zod-typed `ReviewJudgment` per pending doc — never free text |
| D2 | Confidence-gated triage | Judgment either auto-executes (whitelisted type, above threshold, in `auto` stage) or escalates to a human with structured blocking questions |
| D3 | Audit trail | Every lifecycle transition (automated or human) emits an append-only `AuditEvent`; `lore audit <doc>` answers "who decided what, on which input, on what basis" |
| D4 | Calibration data | Human confirm/override of AI judgments accumulates as labeled `CalibrationRecord`s; aggregated into per-doc-type × per-prompt-version agreement rates |
| D5 | Self-optimization | L1: assessment `recommendations` feed forward into subsequent spec/plan generation context. L2: judge-prompt versions iterate, evaluated offline against calibration data. L3: thresholds/sampling rates self-tune within hard bounds |
| D6 | Escalation surfaces | CLI triage queue (`lore pending` upgraded), dashboard panel (extends SPEC-033), push notification on escalation events |

### 14.2 Data entities (Zod SSOT, all append-only)

- **ReviewJudgment** — `{decision: approve|reject|escalate, confidence: 0-1, reasons[]: {dimension, finding, evidence_ref}, checks[]: deterministic pre-checks run (schema validity, check-tree, link integrity, evidence completeness), judge: {provider, model, prompt_version}}`. Judge identity is the exact `{provider, model, prompt_version}` tuple — this tuple is what I1 compares. An `escalate` decision MUST carry `blocking_questions[]` — the exact points the AI could not resolve become the human queue's display content. Deterministic checks run BEFORE the LLM: a doc failing schema/tree checks is rejected without burning a judge call (the `check-tree` pre-check depends on SPEC-032 arming the blueprint — declared dependency).
- **AuditEvent** — `{actor: human id | ai judge identity, action, doc_id, doc_version, judgment_ref?, timestamp}` for every status transition. This is a NEW queryable surface (`lore audit <doc>` / `lore audit --verify`) — SPEC-012 telemetry is a write-only JSONL sink with no read path; storage may reuse that sink (NFR-7: audit separate from corpus storage) but the query surface is net-new build, not an extension. Completeness is an oracle: zero transitions without a matching event.
- **CalibrationRecord** — `{judgment_ref, human_outcome: confirmed|overridden, delta_reasons[]}`. Written whenever a human acts on (or samples) an AI judgment. The aggregation over these records — agreement rate per doc type per prompt version — is the single data source for stage unlocks (14.3), circuit breakers, and L2 prompt selection. No unlock decision may cite AI self-reported confidence alone.

**Ground-truth caveat (acknowledged, not solved)**: with a single human owner, "agreement" measures consistency with one person's decisions, not objective doc quality. For an internal tool this is definitionally acceptable — the owner's judgment IS the approval standard being automated — but it means agreement data cannot detect owner-correlated blind spots. Mitigations: I2 stratified sampling, L1 provenance tagging (14.6), and the §8 kill criterion. When the team grows past one reviewer, per-reviewer calibration becomes the upgrade path.

**Trigger model (no daemon)**: judgments are computed on demand — `lore review <doc>` (single) and `lore review --pending` (batch) CLI/MCP verbs; optionally invoked by the create/set flows behind config. Consistent with SPEC-025's read-side-computation ethos: no background process, no heartbeat. Judge-call cost is bounded by SPEC-026-style char budgets; a batch run over N pending docs makes at most N judge calls, deterministic-check failures short-circuit for free.

**Storage & testability**: Zod schemas live in `@lore/core`; judgments/calibration records persist in dedicated store tables (not doc `extra` — they are cross-doc data, §13.4 SSOT); 14.3 thresholds live in `LoreConfigSchema` following the `workflow.claim_ttl_minutes` precedent. The store MUST expose a seeding path for synthetic CalibrationRecords so 14.3 state transitions and circuit breakers are CI-testable without accumulating real judgments. Rolling-agreement aggregation reads a bounded, indexed window (last 50 records per type) — O(window) per recompute, never a full-table scan; NFR-2's query budget applies to it.

### 14.3 Staged unlock state machine (per doc type, data-gated)

Every doc type starts in **shadow** and advances only on measured data; ambition is capped by evidence, not by policy:

| Stage | Behavior | Entry condition |
|---|---|---|
| shadow | AI judges every pending doc, judgment recorded + shown as advisory; human still decides everything (no load reduction — this stage buys calibration data, not time) | Day 1, all types |
| assist | Human queue is triaged: AI-confident items pre-sorted with one-keystroke confirm; escalations flagged with blocking questions. Partial load reduction | ≥20 calibration records for the type |
| auto | AI executes approve/reject itself above the confidence threshold; below threshold → escalate. Human sampling floor stays active. This stage delivers the ↓70% target | Wilson-score lower bound of rolling agreement ≥0.90 at n≥50 for the type (raw "95% over 50" has a confidence interval too wide to distinguish signal from noise — the gate is the interval bound, not the point estimate) |

- Expected (not mandated) unlock order: knowledge → task → plan → spec/PRD — low blast radius accumulates data fastest. The data, not the roadmap, decides.
- **Blast-radius-scaled strictness**: the `auto` bound is per-type config; defaults 0.90 for knowledge/task, 0.95 for plan/spec/PRD. High-stakes types demand tighter evidence, not just more of it.
- **Honest expectation**: at this team's volume, spec/PRD types may never reach `auto` — that outcome is acceptable, not a failure. `assist`-level triage (pre-sorted queue, blocking questions) already delivers the owner's core ask for those types; G9-R2 is satisfiable by any type reaching `auto`, and unlocking only low-stakes types is the expected, honest reading.
- **Rolling window**: agreement is computed over the most recent 50 judgments per type (config), recomputed on every new CalibrationRecord.
- **Circuit breaker**: the Wilson lower bound drops below the unlock threshold → the type reverts to shadow automatically + push notification. Re-entry requires re-satisfying the full entry condition on NEW post-reversion data (no flapping: one reversion costs the type its accumulated streak).
- All thresholds (bound, window sizes, sampling floor) live in config with the defaults above; L3 may tune them only within §14.4 bounds.

### 14.4 Non-negotiable invariants

| ID | Invariant | Rationale |
|---|---|---|
| I1 | Approver ≠ author, mechanized: the judge tuple `{provider, model, prompt_version}` that authored a doc cannot auto-approve it; reviews use an independent judge prompt (substrate: SPEC-030 hermetic judge sessions — LIVE). **Honest limit**: this is process independence, not statistical independence — same-model judges share correlated blind spots. Cross-provider judging is a config option, and the residual correlated-error risk is exactly what I2 sampling exists to catch | Blocks the AI-writes → AI-approves → feeds-AI self-reinforcement loop, to the extent prompt-lineage separation can |
| I2 | Human sampling floor: even fully unlocked types route ≥10% of auto-decisions to human spot-check, **stratified** per doc type × judge prompt_version (flat random sampling has weak power against clustered failures, e.g. one bad L2 prompt iteration degrading one type); sampling is seeded/deterministic in tests. L3 may raise but never lower the floor, never to zero | LLM error rate is irreducible; unsampled automation lets errors compound silently |
| I3 | Every automated decision is reversible: version history stays append-only; `lore audit` links decision → judgment → doc version for one-command rollback | Automation without cheap reversal is a ratchet |
| I4 | AI-generated improvements are draft-first AND provenance-tagged: L1/L2 outputs (injected context, new prompt versions) never mutate approved docs directly; every L1 recommendation injected into a generation context carries its source `judgment_ref` so later audits can trace — and discount — self-reinforced context | Self-optimization must not pollute the SSOT it optimizes, visibly or invisibly |
| I5 | Escalation is fail-loud default: any judgment outside whitelist/threshold/stage escalates; no silent fallback to auto | Extends D-007 fail-loud philosophy to decisions |

### 14.5 Success metrics

R1 exit (oracle-checkable in CI + corpus):

| Metric | Baseline (2026-07-06) | Target | Measurement |
|---|---|---|---|
| Audit completeness | 0 (no audit surface) | 100% of transitions have an AuditEvent | `lore audit --verify` oracle |
| Judgment coverage | 0 | 100% of pending docs carry a ReviewJudgment when reviewed | CLI queue render |
| Calibration volume | 0 | ≥20 records on ≥2 doc types | store count |

R2 exit (requires weeks of real usage — measured, not CI-asserted):

| Metric | Baseline (2026-07-06) | Target | Measurement |
|---|---|---|---|
| Human review decisions/week | 100% of transitions manual (12-doc queue, 2+ day dwell) | ↓≥70% (denominator: measured R1 weekly decision volume, recorded before R2 starts) | AuditEvent aggregation |
| Escalation precision | n/a (no triage) | ≥80% of escalated items genuinely needed the human (owner-relative by construction — it measures "AI escalates trivia" annoyance, not objective necessity) | CalibrationRecord on escalations |
| Agreement (unlocked types) | n/a | Wilson lower bound ≥0.90 rolling | CalibrationRecord aggregation |
| Median time to detect+rollback a wrong auto-decision | n/a | ≤7 days (I2 sampling + a weekly `lore audit` digest bound the detection window) | AuditEvent timestamps |

**Kill criterion (§8 addition)**: if after 8 weeks of shadow mode any of — weekly judgment volume <10, or agreement so noisy the Wilson bound cannot reach 0.90 at any achievable n — then freeze the loop at `assist` permanently and record a decision-gate ADR; the calibration machinery (SPEC-036+) is not built.

### 14.6 Delivery stages & spec split

- **R1 — close the loop (shadow/assist)**: D1 judgment schema + on-demand review verbs, D3 audit events on every transition, D6 CLI triage queue, D4 records start accumulating. Shadow itself reduces no load (human still decides everything); the first relief arrives when types reach `assist` (pre-sorted queue, one-keystroke confirm).
- **R2 — unlock self-decision** (contingent on R1 data volume passing the kill criterion): 14.3 state machine live; types unlock on data. D5-L1 feed-forward: assessment `recommendations` are injected at the AI-template context-assembly point (`AIProviderService` template render, the same seam SPEC-026 uses) when generating a child spec/plan under the assessed plan's lineage — each injected item provenance-tagged per I4. Dashboard panel (after SPEC-033) + push channel: a configurable exec hook (`notify.command` in config — shell command receiving the escalation event as JSON on stdin; no vendor-specific channel).
- **R3 — self-optimization** (contingent on R2 exit metrics): D5-L2 prompt iteration (offline eval against calibration data, winner promoted), D5-L3 bounded threshold self-tuning.
- **Stage-gate reviews are self-hosted**: each R-stage exit review runs through `lore assess` (SPEC-026) against this section's metrics and persists as an assessment doc under the stage's plan — the loop's own gates leave the same evidence trail the loop enforces on everything else. No stage may be declared passed from memory or chat; the assessment doc is the gate record.

Committed landing specs (R1 only): **SPEC-034** structured review judgment + triage queue (D1, D2-triage, D6-CLI); **SPEC-035** audit trail + calibration data (D3, D4). Input-quality hardening serving every R stage (committed 2026-07-08, NOT an R2 unlock): **SPEC-038** AC-as-code — structured, oracle-bound acceptance criteria on specs (`extra.acceptance_criteria`, script/ai/human verify modes, evidence `ac_ref`, assess judges against the declared AC set; see ADR "AC-as-code"). Contingent (named by capability for traceability, NOT committed — each requires a decision-gate ADR citing R1/R2 data before creation; the spec numbers originally reserved here as SPEC-036–038 have since been consumed by other landed specs — refer by capability name): unlock state machine + auto-execution; L1 feed-forward; L2/L3 self-optimization. This staging exists because §9-R1 (second-system syndrome) applies to §14 itself — a 5-spec autonomous-review platform built ahead of its data is the failure §14 is designed to prevent. Declared dependencies: SPEC-034's check-tree pre-check needs SPEC-032 (blueprint arming); the dashboard escalation panel needs SPEC-033. Benchmark patterns to validate at design time: confidence-triaged AI code review (CodeRabbit / GitHub Copilot review), LLM-observability data models (Langfuse / LangSmith traces + scores + prompt versions), active-learning sampling loops (Label Studio-class systems).

### 14.7 Assessment dimension framework v2 (input-quality hardening, committed 2026-07-10)

The v1 assess rubric is one-dimensional (per-AC evidencing) and its `gaps`/`recommendations` are free-text — the measured §14 gap "recommendations that no downstream consumer reads" is structural: untyped output cannot be programmatically consumed. Committed upgrade (landing spec: SPEC-040), serving every R stage like SPEC-038; NOT an R2 unlock, §14 staging untouched:

- **Two-layer split**: deterministic facts are computed in code and FED to the judge (AC coverage incl. attested ratio — already live; per-task evidence completeness; scope-match between plan-declared scope and spec AC surface; gate/process compliance), while judgment dimensions are reserved for what has no executable oracle. The judge never re-derives what code can compute (IoC ADR boundary 1).
- **Typed multi-dimension rubric**: `outcome` (AC satisfaction — v1 carried over), `evidence_integrity` (claims backed by attested vs self-reported evidence), `scope_fidelity` (delivered = planned; creep/cut named explicitly). Per-dimension score + advisory-only judge confidence + `based_on: evidence|absence` grounding declaration. `regression_risk` and `knowledge_capture` are NOT judge dimensions — SPEC-040's 3-lens design review found them ungrounded in bundle-visible material (fabrication invitation); both are demoted to deterministic facts (tests-touched/attested-ratio signals; knowledge-link counts).
- **Typed findings**: `gaps[]` → `{dimension, severity, ac_ref?, statement}`; `recommendations[]` → `{target: spec|plan|prompt|skill|process, action, rationale}` carrying provenance (I4). This is the D5-L1 consumer-side unblock: R2 feed-forward injection requires typed recommendations to exist first.
- **Judge self-declared uncertainty**: `unverifiable[]` names materials the judge could not see (complements the diff Truncation Manifest); scoring an unseen material down without a matching `unverifiable` entry is a mechanically detectable rubric violation.
- **Scope-fit fix**: a narrow plan hanging off a broad spec is judged against the plan-declared AC subset (evidence: `knowledge-assess-usage-patterns` #1 — 63/100 despite complete in-scope delivery).
- **Golden-set regression gate (the L2 harness arrives early)**: promoting a new assess prompt/rubric version requires non-inferiority on replayed historical assessments labeled by human outcomes (the existing assessment docs + SPEC-035 calibration overrides are the seed corpus). The same data discipline §14.3 applies to autonomy applies to the instrument itself — no rubric version ships on vibes.

Baseline instrument-defect evidence: `knowledge-assess-material-budget-distortion` (3× systematic under-scoring, 30-50 points), `knowledge-assess-usage-patterns` (#1 scope mismatch, #9 ±2 score noise), `knowledge-round-3-findings` (judge session contamination — since fixed by SPEC-030), §14 intro's unconsumed-recommendations gap.

### 14.8 Attestation reachability & exemption taxonomy (committed 2026-07-28)

The evidence-trustworthiness line (SPEC-039 trusted runner → SPEC-069 attestation floor) assumed every plan can reach `lore verify`; the 2026-07-27 audit-remediation plan (cross-spec, PRD-parented) proved the assumption silently false — the floor denied at close time with a recovery command that could not run, and the only escape was an untyped exemption boolean. Landing spec `spec-verify-reachability-plan-promote-early-warning` (2/2 tasks attested-verified, closed without exemption) hardens the boundary three ways: (1) a plan-promote ADVISORY (never a deny — cross-spec plans stay legal) warning at promote time when `lore verify` will be structurally unreachable (no spec-tier ancestor, or zero script-mode ACs); (2) the ATTESTATION_FLOOR_NOT_MET feeding pack now branches on the same reachability derivation — it never again recommends an impossible `lore verify`; (3) exemptions are typed: `extra.attestation_exempt_kind ∈ {red-tdd, no-oracle, pipeline-unreachable, other}` is REQUIRED whenever `attestation_exempt: true` (fail-loud, no legacy fallback), so audit readers can distinguish "unverified" from "verified but unattestable". Deferred by decision (future spec candidate): resolving verify ACs across `implements`-linked specs for multi-spec plans — the model-level fix; this round only makes the single-parent boundary honest.


### 14.9 Two-runner regression selection (committed 2026-07-28)

Oracle-quality hardening one layer below attestation: the worktree regression sweep `vitest --changed` is structurally blind to `.bun.test.ts` consumers (two-runner convention), demonstrated when SPEC's exemption-kind change broke bun-side cascade fixtures behind a green 4504-test vitest sweep. Landing spec `spec-two-runner-changed-test-selection-deterministic-test`: `bun run test:changed [<base>]` selects across BOTH runners via transitive reverse-dependency BFS over a regex import graph, with named dependency-closure escapes (`dist/lore`-spawning binary-consumers auto-included on any src change, `bun run build` forced first — the stale-dist false-oracle lesson mechanized at selection time) and mandatory accounting (per-runner counts + per-file reason tags; zero-selection under src changes warns loudly). Known bounded limitation: dynamic imports are excluded by design, so the selector's own test (which dynamic-imports the script) is reachable only as a changed-test, not transitively.

### 14.9.1 The selector's universe and its scope algebra (committed 2026-08-20)

Two coverage properties of §14.9's selector, both measured rather than reasoned about, because
both were silent while the selector reported success.

**The shipping surface was outside the universe.** `hooks/**` and `assets/**` — the files that
ARE the push gate — selected no tests on their own account. A hook-ONLY change set was refused
correctly with loud-zero, exit 1, so the hole was invisible in the case anyone would test. The
realistic case is hook + any matched file, and editing `assets/` FORCES regenerating the assets
manifest, which is a matched file: the selection came back non-empty, loud-zero stayed quiet, and
both pre-push guards were still absent. ⛔ Loud-zero is therefore not a coverage guarantee — it
only detects the empty selection, never the wrong one.

**Scope classification is a SET, not a first match.** The fix above added a third tree-scan scope
and, by returning on first match, stripped every other scope from any test that also qualified.
Two tree-scanning oracles lost `repo-tracked-text-source`, the broadest scope, and stopped being
selected for ANY repo-tracked text change; four lost `packages-test-tree`. So one under-selection
hole was closed and a wider one opened, in the same commit, and `lore assess` found it only after
the closing criterion was attested and its task archived.

The invariant that follows, and it generalises past this selector: **a change to selection must
declare which scopes it ADDS and prove it removes none.** Membership and scope are conjunctive
gates — an earlier attempt that fixed only membership was measured completely inert — so a
selection fix is never a one-line change, and the proof obligation runs in both directions.

Coverage is asserted against the REAL guard files, not fixture stand-ins: a suite that writes its
own fixture text at the guard paths proves only that the selector recognises text the suite itself
authored, and stays green through any reformat of the file that actually ships.

Residual, unchanged: dynamic imports are still excluded by design, and a tree-scanning test that
names no literal path is still invisible.

### 14.10 Loop instrumentation + enforcement arrives (landed 2026-07-28)

Three mechanisms closed long-standing gaps this section had DESCRIBED but never measured or enforced. All three are landed, attested, and merged.

**Measurement (SPEC-102, trace layer).** §14's premise is data-driven self-optimization, but until now the loop had no read-side data at all: gate SKIPS were audited while gate DENIES vanished, and nothing recorded whether a doc was ever read. `trace_events` (migration-011) is a local-only, fire-and-forget, append-only stream over reads (`get`/`search`/`feed`/`context_bundle`) and gate denies, aggregated by `lore trace stats`. First measurement, same day, across three corpora: **832 of this corpus's docs had never been read**, guyin 161, babyai 455 — the "write-automation exceeds read-consumption" asymmetry became a tracked number instead of an impression. Deny data arrived immediately too (spec-create 4 · review-judgment 2 · plan-close 2 · task-claim 1), which is how the freshness gate below was scoped correctly rather than guessed. Deliberately NOT replicated to Turso: raw search queries are local-only, and team-visible read logs would need their own opt-in spec.

**Enforcement of I1, early (SPEC-103, tiered review).** §14.4's I1 (approver ≠ author) was stated as an invariant but nothing enforced it: measured reality was 40 of 40 approvals performed by the writing orchestrator itself. `ReviewService.approve` now REQUIRES a ReviewJudgment for the doc's CURRENT version for configured durable types (default spec+adr), with worst-decision-wins per version so a reject cannot be outrolled by re-running the judge, and two audited escapes (`--override-judgment <id>` for a named judgment — including a stale-version one, which is frequently the blocker — and `--override-no-judgment` for the never-judged case). This is I1's deterministic half arriving BEFORE the 14.3 staged-unlock machinery, not a replacement for it: staged unlock stays data-gated exactly as specified. Ledger sub_types (assessment/retro/handoff/uat) exit the review-object universe entirely and are therefore exempt from the 14.3 state machine by design — there is no approval decision to automate for a台账 record.

**Honest limit on I1 today.** `ai_provenance` is stamped only when the active provider can report a real model id (the `ModelAwareProvider` capability, implemented by `HttpAIProvider`); it is OMITTED rather than filled with the provider name when it cannot. `claude-cli` shells out and genuinely cannot know its own model, so on this corpus provenance is absent and **I1 collision detection is N/A** — the judgment-required gate is the whole protection here. A dishonest tuple that could never collide was removed in favor of an honest absence.

**Feedback-loop hygiene (SPEC-106, assessment freshness).** An assessment that TRIGGERS follow-up work silently goes stale by its own success: measured this session, two plans' assessments ran before the hardening those very assessments spawned. `lore assess` was timestamp-blind and nothing marked a stored assessment superseded. The `plan-close` gate now carries an `assessmentFreshness` predicate — closure is denied when the plan's newest `evidence`/`done` AUDIT row postdates its newest linked assessment (audit rows, not doc mtime, so anchor adds and link writes never false-positive). `lore assess` itself only warns: gating the remedy on the condition it cures would deadlock. Staleness is computed read-side, never stored.

**What this changes for §14's staging.** R1's "audit completeness" and "judgment coverage" exit metrics now have instrumentation behind them, and the calibration data §14.3 needs can finally accumulate against real deny/judgment traffic rather than hypothetical volume. The kill criterion is unchanged and still applies.


## Acceptance Criteria (structured)

- [·] [script] AC-DOV-1: Content parity with source PRD section holds: lore migrate prd-to-outline --dry-run for this section exits 0 reporting already_migrated=true with 0 failed invariants (char-coverage, section-ref set equality, R-id set equality)
  script: e2e — lore migrate prd-to-outline --prd prd-lore-internal-first-ai-team-knowledge-platform --section autonomous-feedback-loop-ai-review-data-driven-self-optimization --dry-run
