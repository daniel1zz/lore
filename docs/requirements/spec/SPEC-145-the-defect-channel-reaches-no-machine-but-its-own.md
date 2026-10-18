---
id: SPEC-145
type: spec
role: spec
title: "The defect channel reaches no machine but its own: GitHub becomes intake while the corpus keeps resolution authority"
status: approved
priority: critical
created: 2026-08-23
updated: 2026-10-18
tags: [defect-channel, transport, github, intake, cap-removal]
links:
  - {id: ADR-037, type: informs}
  - {id: SPEC-072, type: supersedes}
  - {id: SPEC-139, type: supersedes}
  - {id: SPEC-115, type: supersedes}
---
## Overview

The defect channel reaches no machine but its own. `feedback.upstream.corpus_path` is an absolute local path opened as SQLite (`packages/core/src/config.ts:743`), write contention is handled by `PRAGMA busy_timeout`, and `transport: z.enum(["sqlite","http"])` is a comment reading `P2 seam (named, NOT implemented)`. Measured 2026-08-23: a consumer on another machine has no value it can put in `corpus_path`, so SPEC-072's "consumer defect feedback loop" only ever functioned while upstream and consumer shared a filesystem.

This spec moves intake to GitHub issues while the corpus retains authority over resolution. Authority is declared per field, never per system — see `adr-a-tracker-is-replaceable-a-corpus-is-not-github-is-the` for why the alternative ("GitHub is the SSOT") is rejected: `corpus-service.ts:4487` refuses a `resolves` edge whose target is not a task carrying `extra.issue_report`, so a pointer-only record collapses the 9-state vocabulary to 7, and GitHub's "Close as completed" would become an unclosable back door around the unconditional `--state fixed` rejection.

It also removes the open-report cap outright. The cap's stated purpose was bounding drafts inside one SQLite file; with intake on a hosted tracker, abuse control is GitHub's and the cap only refuses honest reporters. Measured today: 10 open reports against a ceiling of 10, i.e. the channel was refusing every new report while 6 criticals sat untriaged.

## Scope

**In**

- `GhRunner` — the single `gh` subprocess seam (`execFile` with an argv array, scrubbed env, `gh api` JSON only, explicit `maxBuffer`). ⛔ The remedy literals `cli.github.com` and `gh auth login` MUST live inside `gh-runner.ts`, not in the error-code module and not in the CLI's `utils.ts`: AC-GI-7's scan covers `packages/lore/src`, so a remedy string parked in `adapters/cli/utils.ts` would match `gh auth` outside the runner and make AC-GI-7 and AC-GI-2 mutually unsatisfiable. Siting them in the runner is also the right SRP call — knowing how to remedy a broken `gh` is the runner's knowledge, while the error module only defines codes.
- `GitHubIntakePort` — `verifyTarget` / `searchDuplicates` / `fileIssue` / `listIssues` (batch). Replaces the six-method corpus-shaped `UpstreamPort`.
- `frontMatterCodec` — metadata serialised into the issue **body**, because the REST docs state that labels set by a user without push access are *silently dropped*. **Closed field set, two classes**: reporter-supplied (`severity`, `category`, `tags`) and provenance/transport (`reporter_corpus`, `reporter_root_prd`, `idempotency_key`). AC-GI-11's equality check is defined over exactly these six, which is possible only because the key is persisted corpus-side too — see `ReceiptLogV2`.
- `ReceiptLogV2` — two-phase local record on a **new file path** (`receiptEntrySchema` is `.strict()` with exactly `{upstream_doc_id, title, at}` at `service/receipt-log.ts:53-59`, so added fields would make new lines parse-fail on an older binary). **`idempotency_key`**: a client-generated ULID, written in the `intent` line *before* the network call, embedded in the issue body's front matter, and repeated in the `outcome` line. It is what makes a retry recognise its own prior attempt (QA-7) and what pairs an `intent` with its `outcome`. It is **also persisted corpus-side** as `extra.issue_report.idempotency_key`, so reconciliation does not depend on a consumer's local receipt file — which the upstream never has when it is the party migrating or reconciling.
- `ResolutionProjector` — one-way projection of the corpus-computed resolution onto a `resolution:<state>` label; read back only to detect drift.
- Three new error codes with distinct exit codes: `TRANSPORT_UNAVAILABLE`, `RATE_LIMITED`, `AUTH_REQUIRED`.
- Cap removal: `OPEN_REPORT_CAP`, `resolveOpenReportCap`, `countOpenReports`, `OpenReportCapRefusal`, `QUOTA_FREEING_RESOLUTIONS`, `listOpenAdhocDrafts`.
- Read-side `--severity` / `--category` filters on `lore issues`, plus `lore issues --verify`.
- Migration of the 12 already-filed reports.
- Deletion of the SQLite transport (`flows/upstream-context-flow.ts`, `flows/upstream-probe.ts`, `toWriteContentionError`).

**Out**

- Bidirectional sync. GitHub-side edits are advisory input, ratified only through `lore issue resolve`.
- Filing from CI or a machine without `gh` — refused loudly, never a silent no-op.
- Mirroring GitHub comment threads into the corpus.
- Converging `category` to an enum. Measured: 12 reports carry 10 distinct free-text categories, so an enum would freeze an immature taxonomy into SSOT. A category is promoted to a curated label once it repeats past a threshold; `mirror-export` and `judge-truncation` (2 each) are the first candidates.
- **Deleting the `feedback.inbound.open_report_cap` config key — ever.** The key becomes `.optional()` and ignored-with-a-warning, permanently. `FeedbackConfigSchema` is `.strict()` at all three levels, so any config still carrying the key would fail to parse *machine-wide*, and `.lore/config.yaml` is gitignored (`.gitignore:18`) so a binary downgrade cannot un-edit it. One retired key costs nothing to keep; the failure mode costs a whole machine's command surface. This is a decision, not a deferral.
- **A client-side per-actor throttle.** It would be security theatre: anyone willing to flood the tracker can call `gh` or the web UI directly, bypassing lore entirely, so the control only slows honest reporters. Admission control is GitHub's abuse protection, and R3 is accepted as residual with **no oracle**, stated plainly rather than papered over.

## Per-Field Authority

| Field | Authority | GitHub representation | Read back as truth |
|---|---|---|---|
| title, description, expected, actual, repro | consumer at filing; corpus archives | issue title + body | no |
| severity, category, tags | **reporter**, any permission level | body front-matter | yes — sole copy |
| resolution (9 states) | **corpus** (`computeIssueResolution`) | `resolution:*` label | **never** — drift check only |
| `state` / `state_reason` | GitHub | native | advisory; ratified via `lore issue resolve` |
| `adopted` owner pointer | **corpus**, typed `plan\|task` | not representable | n/a |

The label round-trip that AC-GI-4 exercises exists solely as the drift-detection path AC-GI-5 drives. It never licenses treating the label as truth — that is a property of this table, not something a test run can witness, which is why it lives here rather than inside an acceptance criterion.

## Migration Plan

| Phase | Scope | Rollback |
|---|---|---|
| P0 | `GhRunner`, three error codes, read-only health check in `lore setup --check` | pure addition — delete it |
| P1 | Cap removal: delete the six symbols and 1214 lines of cap tests. The config key `feedback.inbound.open_report_cap` becomes `.optional()` + ignored-with-warning and is **never deleted** (see Scope → Out) | restore the symbols; the key never left |
| P2 | `GitHubIntakePort`, `frontMatterCodec`, `ReceiptLogV2`. SQLite path still selectable | config switch back |
| P3 | Migrate the 12 reports: create then PATCH (state cannot be set at creation), concurrency 4. Corpus records are **kept**, gaining `extra.issue_report.github = {repo, number}` **and a migration-time-minted `extra.issue_report.idempotency_key`** — without it AC-GI-11's sixth field has no corpus source | close/delete the created issues; corpus untouched |
| P4 | Remove the SQLite transport **modules** (`flows/upstream-context-flow.ts`, `flows/upstream-probe.ts`, `toWriteContentionError`). **No config key is deleted in this phase or any other**: the transport-selection keys (`feedback.upstream.corpus_path`, the unimplemented `transport` seam) become `.optional()`-and-ignored, same treatment and same machine-wide-parse reason as the cap key, which this phase does not touch | **none** for the module deletion — gated on P0–P3 all verified. The config keys stay parseable (asserted by AC-GI-14), so no config rollback is needed |
| P5 | `ResolutionProjector`, `lore issues --verify`, read-side filters | projector is write-only; stop running it |

## Risk Registry

| # | Risk | Severity | Mitigation | Oracle |
|---|---|---|---|---|
| R1 | `reporterProject` is built as `` `${basename(root)} (${root})` `` (`report-issue-wiring.ts:225`) — an absolute `$HOME` path — and the actor os-fallback tier (`actor-resolution-node.ts:114`) emits the OS username. Both would land in a public issue, and GitHub caches edits | HIGH | redaction before body assembly: identity = corpus name + root-PRD id; `$HOME`→`~`; os-fallback actor dropped; body via `--body-file -`; values after `--` | AC-GI-6 |
| R2 | `gh` infers its target from `GH_REPO` / `GH_HOST` / `GH_CONFIG_DIR` / git remote, all attacker-influencable → reports filed into an attacker's repo | HIGH | resolve the target repo once from config and pass it explicitly; never `-R` from a remote; scrub those env vars; assert `gh api user` login before filing | AC-GI-8, AC-GI-2 |
| R3 | No admission control once the cap is gone, audience widened to the internet | MEDIUM | **None, deliberately.** A client-side throttle is bypassable by calling `gh` directly, so it would only slow honest reporters. Admission control is GitHub's | **none — accepted residual** |
| R4 | create-then-PATCH failing halfway leaves a public open issue with no `resolution:` label and no local trace | MEDIUM | the two-phase receipt is the reconcile target — an `intent` with no `outcome` for the same `idempotency_key` | AC-GI-3 |
| R5 | `resolution:*` label rot against the corpus-derived state | MEDIUM | `lore issues --verify` diffs them, read-only | AC-GI-5 |
| R6 | GitHub's "Close as completed" maps naturally to `fixed`, which lore rejects unconditionally — this is the load-bearing reason GitHub is not the resolution SSOT | MEDIUM | `state_reason` is advisory only; `lore issue resolve` is the sole path into a corpus verdict | AC-GI-13 |
| R7 | A case-insensitive or identifier-normalising scan would make AC-GI-9 (no `OPEN_REPORT_CAP`) and AC-GI-10 (the `open_report_cap` key must survive) mutually unsatisfiable — they are case variants of one string | LOW | AC-GI-9's matcher is pinned to a **case-sensitive** literal scan of the six symbol names | AC-GI-9 + AC-GI-10 both green simultaneously |

## Review Revisions — round 1

Recorded per the discipline that a criterion changed after it was written must carry its reason. All five below were raised by `lore review` on v2 of this spec, **before any AC had evidence** — none is a post-red weakening:

1. **P1/P4 config-key contradiction** (blocking question). P1 forbade deleting the cap key while P4 said "delete the config key" with rollback `none`. Resolved by deciding the cap key is *never* deleted, and narrowing P4 to the transport-selection keys — which get the same `.optional()`-and-ignored treatment. Both readings the reviewer identified are now closed.
2. **AC-GI-10 scoped only to "after P1"**, leaving the riskiest phase uncovered. Restated to assert the permanent behaviour, with no phase qualifier.
3. **R6 had no oracle** though it is the Overview's central argument. Added AC-GI-13.
4. **AC-GI-3 referenced an `idempotency_key` the spec never defined.** Now defined in the `ReceiptLogV2` scope entry.
5. **R3's throttle was unspecified and unoracled.** Changed the design rather than the wording: the throttle is dropped as security theatre and R3 is declared an accepted residual with no oracle.

Advisory items also applied: AC-GI-7's matcher is pinned to a literal-substring scan over `.ts` sources; AC-GI-11's field set is closed to the six named in Scope; AC-GI-12's prose latency clause is dropped so prose and structured form assert the same thing.

## Review Revisions — round 2

Raised by `lore review` on v14, again before any AC carried evidence:

6. **AC-GI-11's sixth field had no corpus source.** Round 1 added `idempotency_key` to the closed field set, but it lived only in the receipt log and the issue body, so the equality check was undischargeable for the 12 migrated reports. Resolved by persisting it corpus-side as `extra.issue_report.idempotency_key` and amending P3 to mint one at migration time — chosen over dropping the field, because upstream-side reconciliation must not depend on a consumer's local receipt file that the upstream does not have.
7. **AC-GI-9 and AC-GI-10 were mutually unsatisfiable under a case-folding matcher** (`open_report_cap` vs `OPEN_REPORT_CAP`). AC-GI-9's matcher is now pinned case-sensitive, and the collision is recorded as R7 with both-green as its oracle.
8. **AC-GI-6 was environment-dependent** — an ambient scan for "the OS username" yields opposite verdicts on a laptop and under a CI account named `runner`. Restated as a property test over seeded values.
9. **AC-GI-10 asserted an unwitnessable property** ("permanently, at every phase"). The executable half stays in the AC; the permanence stays in Scope → Out as policy.
10. **AC-GI-12 was satisfiable by a large constant.** Restated as equality of call count at N=1 and N=50.
11. **P4's cell opened with a delete verb** and only corrected itself in a later clause. Rewritten so no config key is described as deleted anywhere.
12. **AC-GI-4 read as licensing a read-back-as-truth path** the authority table forbids. The AC now names the read-back as the drift path only.

## Review Revisions — round 3

Advisory-only round; no blocking question remained. All three raise mechanical checkability, and all still predate any AC evidence:

13. **AC-GI-7's token set was open** — "a gh subcommand" left each implementer to choose the scanned literals, and a narrow list passes vacuously. Closed to `gh api`, `gh issue`, `gh auth`, `gh repo`, pinned the way AC-GI-9 pins its six symbol names.
14. **AC-GI-4 carried a normative clause no run can witness.** Moved into the Per-Field Authority prose; the AC now asserts only the round-trip.
15. **AC-GI-2's remedy string was reader-supplied.** Pinned to two literals, one per condition.

Also cosmetic: R7 was appended to the Risk Registry rather than left mid-table.

## Review Revisions — round 4

16. **The transport keys' parse-survival was unoracled.** P4 gives `feedback.upstream.corpus_path` and the unimplemented `transport` seam the same `.optional()`-and-ignored treatment as the cap key, citing the same machine-wide parse-failure mode, and P4's module deletion has rollback `none` — yet AC-GI-10 covers only `open_report_cap`. Added **AC-GI-14** with the same shape for the transport keys, rather than widening AC-GI-10: one AC covering three keys can pass while testing only one, and P1 and P4 need separately gateable assertions. Its test file is distinct (`transport-config-compat.test.ts`) so each AC remains traceable to a file rather than to a `describe` title the anchor grammar cannot express.

## Review Revisions — round 5

17. **AC-GI-7 and AC-GI-2 were mutually unsatisfiable depending on an unstated implementation choice.** AC-GI-7 forbids the token `gh auth` outside `gh-runner.ts` within `packages/lore/src`; AC-GI-2 requires the remedy literal `gh auth login` to reach stderr. Nothing said WHERE that literal lives, and the natural home — the CLI's `utils.ts`, where exit-code mapping happens — sits inside the scanned tree. Resolved by CONSTRAINING the implementation (the literals live in the runner) rather than weakening AC-GI-7's matcher, since the runner owning `gh` remediation knowledge is also the correct separation of concerns. Raised by `lore review` while re-approving after a falsifier declaration, before any implementation existed.

## Acceptance Criteria

Structured criteria are declared via `lore ac add` and are the executable form; the prose below states each one's intent.

- **AC-GI-1** Cross-machine reach: filing succeeds from a working directory that is not, and contains no, clone of the upstream repo.
- **AC-GI-2** `gh` absent or unauthenticated exits with the `AUTH_REQUIRED` code — not the generic 1 — and stderr carries the matching remedy literal: `cli.github.com` when the binary is missing, `gh auth login` when it is present but unauthenticated.
- **AC-GI-3** A failed filing leaves an `intent` receipt line, with no `outcome` line for the same `idempotency_key`.
- **AC-GI-4** All 9 resolution states survive corpus → label → read-back unchanged.
- **AC-GI-5** A hand-edited `resolution:*` label does not change what `lore issues` reports, and `lore issues --verify` reports the divergence.
- **AC-GI-6** Body assembly leaks neither identity: a property test seeds a distinctive home path and a distinctive username, then asserts neither appears in the assembled body. Seeded rather than ambient, so a CI account named `runner` cannot make the same test pass vacuously on one machine and false-positive on another.
- **AC-GI-7** `gh` is spawned from exactly one module: `gh-runner.ts` exists, and a literal-substring scan of `.ts` sources under `packages/lore/src` for the **closed token set** `gh api`, `gh issue`, `gh auth`, `gh repo` matches no file outside it. The scan covers sources only, not `tests/`, so a test asserting a remedy literal does not trip it — but a remedy literal in production code outside the runner does, which is why Scope pins where those literals live.
- **AC-GI-8** Every `gh` invocation runs with `GH_REPO`, `GH_HOST`, `GH_CONFIG_DIR`, `GH_ENTERPRISE_TOKEN` removed from its env.
- **AC-GI-9** Cap removal is complete: a **case-sensitive** literal scan of `.ts` sources finds no surviving reference to the six deleted cap symbols. Case sensitivity is load-bearing — `open_report_cap`, the config key AC-GI-10 requires to survive, is a case variant of `OPEN_REPORT_CAP`.
- **AC-GI-10** A config carrying `feedback.inbound.open_report_cap` parses successfully and emits a warning naming the key. (The *permanence* of that behaviour is a policy commitment recorded in Scope → Out, not part of this oracle — no test run can witness a property of all future builds.)
- **AC-GI-11** Migration lands 12 issues, 2 of them closed with a `state_reason`, and each of the six closed front-matter fields matches its corpus source.
- **AC-GI-12** No read surface issues one network call per issue: the call count for listing 50 issues equals the call count for listing 1.
- **AC-GI-13** A GitHub-side "Close as completed" on a filed issue does **not** produce a corpus `fixed` resolution: after the close, `computeIssueResolution` still reports the pre-close state, and the only transition into `fixed` remains a `resolves` edge.
- **AC-GI-14** A config carrying `feedback.upstream.corpus_path` and/or the retired `transport` key parses successfully after P4 and emits a warning naming each retired key — the same invariant AC-GI-10 asserts for the cap key, held separately so P1 and P4 gate independently.


## Acceptance Criteria (structured)

- [⚑] [script] AC-GI-7: gh is spawned from exactly one module, measured as TWO conjuncts: (a) gh-runner.ts exists AND imports node:child_process, and (b) no other .ts source under packages/lore/src both names a gh subcommand AND imports child_process. ⛔ Known boundary, recorded rather than papered over: a module that builds the literal at runtime by concatenation AND spawns its own child would evade conjunct (b)'s literal half — measured 2026-08-23 when setup-github-health.ts legitimately concatenated the remedy hint to emit AC-GI-2's wording without tripping the older literal-only scan. That module was verified to import zero child_process and to route every invocation through GhRunner, so the property held; the older oracle simply measured a proxy.
  script: lint — test -f packages/lore/src/service/gh-runner.ts && grep -q "node:child_process" packages/lore/src/service/gh-runner.ts && v=0; for f in $(grep -rl --include="*.ts" -e "gh api" -e "gh issue" -e "gh auth" -e "gh repo" packages/lore/src | grep -v "service/gh-runner.ts"); do grep -qE "^import.*child_process" "$f" && v=$((v+1)); done; test "$v" = "0" && echo "AC-GI-7 PASS: gh-runner.ts both spawns and names gh, and no other module does both"
  other_command=2
- [⚑] [script] AC-GI-9: Cap removal is complete: a CASE-SENSITIVE literal scan of .ts sources finds no surviving reference to the six deleted cap symbols — case sensitivity is load-bearing because open_report_cap, the config key AC-GI-10 requires to survive, is a case variant of OPEN_REPORT_CAP
  script: lint — grep -rnE --include="*.ts" "^[[:space:]]*[^[:space:]*/].*(OPEN_REPORT_CAP|resolveOpenReportCap|countOpenReports|OpenReportCapRefusal|QUOTA_FREEING_RESOLUTIONS|listOpenAdhocDrafts)" packages/; test $? -eq 1 && echo "AC-GI-9 PASS: 0 non-comment case-sensitive matches for the six deleted cap symbols"
  other_command=7
- [⚑] [script] AC-GI-1: Filing succeeds from a working directory that is not, and contains no, clone of the upstream repo
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/cli/github-intake-reach.bun.test.ts && echo 'AC-GI-1 PASS: report filed from a directory holding no clone of the upstream repo'
  other_command=5
- [⚑] [script] AC-GI-2: gh absent or unauthenticated exits with the AUTH_REQUIRED code, never the generic 1, and stderr carries the matching remedy literal: cli.github.com when the binary is missing, 'gh auth login' when present but unauthenticated
  script: test — bunx vitest run packages/lore/tests/unit/service/gh-runner-auth.test.ts && echo 'AC-GI-2 PASS: both auth-absent paths exit AUTH_REQUIRED with a named remedy'
  other_command=1
- [⚑] [script] AC-GI-3: A filing whose network call fails leaves an intent receipt line and no outcome line for the same idempotency key
  script: test — bunx vitest run packages/lore/tests/unit/service/receipt-log-v2.test.ts && echo 'AC-GI-3 PASS: failed filing leaves intent without outcome'
  other_command=1
- [⚑] [script] AC-GI-4: All 9 resolution states survive corpus to label to read-back unchanged
  script: test — bunx vitest run packages/lore/tests/unit/service/resolution-projector.test.ts && echo 'AC-GI-4 PASS: 9 of 9 resolution states round-trip equal'
  other_command=5
- [⚑] [script] AC-GI-5: A hand-edited resolution label does not change what lore issues reports, and lore issues --verify reports the divergence
  script: test — bunx vitest run packages/lore/tests/unit/service/resolution-label-non-authority.test.ts && echo 'AC-GI-5 PASS: label edit does not move the reported state and --verify flags it'
- [⚑] [script] AC-GI-6: Body assembly leaks neither identity: a property test seeds a distinctive home path and a distinctive username, then asserts neither appears in the assembled body — seeded rather than ambient, so a CI account name cannot make it pass vacuously
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-body-redaction.test.ts && echo 'AC-GI-6 PASS: assembled bodies carry no home path and no OS username'
  other_command=2
- [⚑] [script] AC-GI-8: Every gh invocation runs with GH_REPO, GH_HOST, GH_CONFIG_DIR and GH_ENTERPRISE_TOKEN absent from its environment
  script: test — bunx vitest run packages/lore/tests/unit/service/gh-runner-env-scrub.test.ts && echo 'AC-GI-8 PASS: all four GH_* vars absent from every invocation env'
- [⚑] [script] AC-GI-10: A config carrying feedback.inbound.open_report_cap parses successfully and emits a warning naming the key (the permanence of that behaviour is policy in Scope, not part of this oracle)
  script: test — bunx vitest run packages/lore/tests/unit/service/feedback-config-compat.test.ts && echo 'AC-GI-10 PASS: legacy cap key parses and warns by name'
  other_command=2
- [⚑] [script] AC-GI-11: Migration lands 12 issues, exactly 2 closed with a state_reason, and each of the six closed front-matter fields (severity, category, tags, idempotency_key, reporter_corpus, reporter_root_prd) equals its corpus source
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/cli/issue-migration.bun.test.ts && echo 'AC-GI-11 PASS: 12 issues, 2 closed with reason, front-matter equal field by field'
  other_command=2
- [⚑] [script] AC-GI-12: No read surface issues one network call per issue: the call count for listing 50 issues equals the call count for listing 1
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-read-batching.test.ts && echo 'AC-GI-12 PASS: listing N issues costs O(1) calls, not O(N)'
- [⚑] [script] AC-GI-13: A GitHub-side close-as-completed does NOT produce a corpus fixed resolution: computeIssueResolution still reports the pre-close state, and the only transition into fixed remains a resolves edge
  script: test — bunx vitest run packages/lore/tests/unit/service/github-close-not-fixed.test.ts && echo 'AC-GI-13 PASS: a GitHub close-as-completed yields no corpus fixed resolution'
  other_command=2
- [⚑] [script] AC-GI-14: A config carrying feedback.upstream.corpus_path and/or the retired transport key parses successfully after P4 and emits a warning naming each retired key — same invariant as AC-GI-10 for the cap key, held separately so P1 and P4 gate independently
  script: test — bunx vitest run packages/lore/tests/unit/service/transport-config-compat.test.ts && echo 'AC-GI-14 PASS: retired transport keys parse and each is named in a warning'
  other_command=2

## Code anchors

- packages/lore/src/service/gh-runner.ts#GhRunner
- packages/core/src/issue-front-matter.ts#assembleIssueBody
- packages/lore/src/service/receipt-log-v2.ts#ReceiptLogV2
- packages/lore/src/service/resolution-projector.ts#ResolutionProjector
- packages/lore/src/service/resolution-label-port.ts#GhResolutionLabelPort
- packages/lore/src/adapters/cli/setup-github-health.ts#runGitHubHealthCheck
