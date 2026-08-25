---
id: ADR-039
type: adr
role: decision
title: "The vendor intake address ships in the binary; config carries only consent"
status: approved
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [feedback, report-issue, distribution, consent]
parent: PRD-001
---
## Context

`feedback.upstream` carried two different kinds of decision in one field:

- **Addressing** — which GitHub repo a `lore report-issue` report is filed into. For a consumer project reporting a defect in the lore tooling itself, this is a CONSTANT: `issue-report.ts` states the asymmetry directly — "A reporting project structurally cannot know the upstream's AC ids" — the reporting project and the upstream are two different projects, so the consumer has no addressing decision to make.
- **Consent** — whether this project's issue title, description, repro command and actor identity may be sent to a third-party GitHub repository. That genuinely must be decided per project and must never have a default.

`scripts/check-shipped-defaults.ts` exempted the whole field from shipped defaults with one rationale: "configuring it is the per-project consent act; a shipped default would be meaningless or actively wrong." That reasoning is sound for consent and FALSE for addressing — it was being used to justify making every consumer hand-copy a constant, where a typo files defects silently into a stranger's repository.

An out-of-box path once existed (`--auto-config`, `resolveUpstreamFromInstalledBinary`, `provisionFeedbackUpstream`, from `spec-out-of-box-reporting-channel-report-issue-self-provisions`). It was deleted along with the retired SQLite shape it provisioned, and never rebuilt for the GitHub shape — so `lore init` left `report-issue` at exit 4 with no route to a working channel except hand-writing an address.

## Decision

Split the two along their real seam:

- **Addressing ships in the binary.** `VENDOR_INTAKE_REPO` is defined once in `packages/core/src/issue-report.ts` and exported from `@lore/core`. Three duplicate literals (`setup-github-health.ts`'s `LORE_UPSTREAM_REPO`, two e2e suites' `FORBIDDEN_REPO`) converged onto it.
- **Consent stays in config, still with no default.** `FeedbackConfigSchema.upstream` gains a third union branch `{vendor: z.literal(true)}` (`.strict()`). `z.literal(true)` not `z.boolean()`: `vendor: false` must not parse as a configured-but-off state, and `{vendor: true, repo}` must not parse at all — the two intents may not be mixed.
- **One normalization point.** `classifyFeedbackUpstream` (`report-issue-wiring.ts`, the sole `feedback.upstream` read site) maps the vendor branch to `{kind: "github", cfg: {repo: VENDOR_INTAKE_REPO}}`, so every downstream consumer keeps seeing only `{repo}` and needed no change.
- **Self-hosted intake unchanged.** `{repo: "owner/repo"}` behaves exactly as before; the retired `{root_prd, ...}` SQLite shape is still refused loudly.

⛔ The vendor guard MUST be consulted before `isGithubUpstreamCfg`, whose predicate is `"repo" in cfg` — a vendor config carries no `repo` and would otherwise fall through and be reported as the retired SQLite shape. Measured during implementation: moving the guard one line down does NOT turn the oracle red, because the retired branch is a trailing fall-through rather than an `else`; the minimal red-producing mutation is DELETING the vendor branch, which reddens 3 assertions including the MCP wiring one. The earlier claim that the reorder was the minimal mutation was a false assertion and was corrected in place.

## Consequences

Consumers now write only a consent flag, and the address never appears in their config:

```yaml
feedback:
  upstream:
    vendor: true
```

`buildUnconfiguredUpstreamRemedy` names both routes and states that the vendor address ships inside the binary. `check-shipped-defaults.ts`'s rationale was narrowed to consent, which is the half that still holds.

The MCP `lore_report_issue` surface was the last face re-deriving shape policy on its own (`resolveFeedbackUpstreamCfg` + `isGithubUpstreamCfg`); it is now wired to the same classifier. Without that, a legal vendor config would have been reported as a retired SQLite shape on the MCP surface alone — capability without wiring, on exactly the seam this decision is about.

### Known gaps this decision does NOT close

1. `buildRetiredFeedbackUpstreamError` still suggests only `feedback.upstream.repo`, never `vendor`.
2. `vendor: false` and `{vendor: true, repo}` exit 4 with the WRONG REASON: `parseConfig` returns an accurate `feedback.upstream.vendor: Invalid literal value`, but a parse failure outside the `ai` section silently falls back to defaults, so the CLI prints "is not configured". Pre-existing fail-loud gap (SPEC-030 non-goal), not introduced here; recorded as an invariant in `config.ts` rather than fixed in scope.
3. A mixed-intent config's error names only one of the two keys, per `describeConfigIssue`'s fewest-issues selection — isomorphic to the existing `repo`+`root_prd` mixed case.
4. `lore setup --check` probes only the vendor address; a self-hosted `feedback.upstream.repo`'s reachability has never been read by it.
5. **The guard-order MUST has no oracle.** The requirement that the vendor guard precede `isGithubUpstreamCfg` is asserted in prose and in `report-issue-wiring.ts`'s own comments, but measured: reordering it does NOT redden the suite, because the retired branch is a trailing fall-through rather than an `else`. Only deleting the vendor branch is caught. The ordering invariant is therefore UNENFORCED — an agent that reorders it during an unrelated refactor gets a green suite.
6. No spec / no AC-as-code / no lore task lineage — dispatched outside the chain at the user's explicit request for a fast path, so the seven acceptance criteria this change was dispatched against carry no `lore verify` attestation — only command output recorded in the implementer's report. They were:

   1. `VENDOR_INTAKE_REPO` has exactly one definition point (`grep` = 1 hit) and `bun run typecheck` is 0-error.
   2. `FeedbackConfigSchema` accepts `{vendor: true}`; rejects `{vendor: false}` and `{vendor: true, repo}`; `{repo}` / `{root_prd}` unchanged.
   3. `classifyFeedbackUpstream({vendor: true})` normalizes to `{kind: "github", cfg: {repo: VENDOR_INTAKE_REPO}}`, with the retired and unconfigured branches unchanged.
   4. `buildUnconfiguredUpstreamRemedy` names both `feedback.upstream.vendor` and `feedback.upstream.repo`.
   5. `bun run typecheck` 0-error plus green vitest and `bun test` runs over the direct consumers.
   6. `check-shipped-defaults.ts`'s rationale narrowed to consent, script and its test green.
   7. `assets/project/lore-config-template.yaml` carries a COMMENTED vendor example (uncommented would consent on the consumer's behalf), assets manifest regenerated.

   `lore assess` will find no discoverable commit for this change.

### Tooling gap surfaced while landing this

A worktree has no `node_modules`, so `@lore/core` resolves UPWARD to the MAIN CHECKOUT's `packages/core`. The first `bun run typecheck` in the worktree reported `TS2305: no exported member 'VENDOR_INTAKE_REPO'` for an export present in that very worktree. Any agent editing `packages/core` measures the main checkout's copy, not its own — the harness-sees-its-own-copy false oracle. Worked around by hand-linking `node_modules/@lore/{core,lore,dashboard}`; the workaround itself is the signal that this needs a mechanism.
