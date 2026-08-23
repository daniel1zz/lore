---
id: ADR-037
type: adr
role: decision
title: "A tracker is replaceable, a corpus is not — GitHub is the defect channel's intake, never its resolution SSOT"
status: approved
priority: critical
created: 2026-08-23
updated: 2026-08-23
tags: [defect-channel, transport, github, ssot, adr]
parent: PRD-001
---
# A tracker is replaceable, a corpus is not — GitHub is the defect channel's intake, never its resolution SSOT

**Date**: 2026-08-23

⛔ This document does NOT restate its own decision status. The authoritative value lives in `extra.decision_status` (readable via `lore get <slug> --json`), and a prose copy here would be a second store of one fact — the exact drift a reviewer caught on 2026-08-23, when a body reading "accepted" sat inside a doc whose lifecycle status was `draft`.

## Context

`lore report-issue` (SPEC-072) was specified as a "consumer defect feedback loop". Measured 2026-08-23, it cannot serve that purpose for any real consumer:

- `feedback.upstream.corpus_path` is documented in its own schema as *"Absolute path to the upstream repo ROOT"* (`packages/core/src/config.ts:743`). Filing opens the upstream's `.lore/lore.db` directly.
- `write_wait_ms` is applied as the upstream connection's `PRAGMA busy_timeout` — a same-filesystem write-contention model, not a network protocol.
- `transport: z.enum(["sqlite","http"])` sits three lines below `corpus_path` as a comment reading `P2 seam (named, NOT implemented)`.
- `loadUpstreamConfig` reads the upstream corpus's own `.lore/config.yaml` by path, so `sync.enabled` (Turso) cannot substitute — the *locating* mechanism is itself a local path. Routing through Turso would also require shipping the upstream's `LORE_SYNC_TOKEN` to every reporter, i.e. full corpus write access to anyone filing a bug.

⇒ The channel only ever worked when upstream and consumer shared a filesystem — that is, only while dogfooding on one machine. Every mechanism landed in M1–M7 (resolution-keyed cap, `adopted`, terminal-resolution SSOT, judge reachability) hardened a pipe no external consumer could reach. This is the CLAUDE.md fresh-install test failing: *would a project that just ran `lore init` + `lore setup` still hit this? — yes.*

The obvious repair is "make GitHub issues the SSOT". Three independently-dispatched architecture reviewers (domain, DX, cost) each rejected that framing on the same ground, and the code confirms them: `packages/lore/src/service/corpus-service.ts:4487` refuses a `resolves` edge unless the target is `type === "task"` carrying `extra.issue_report`. A pointer-only corpus record therefore makes `fixed` and `resolving` structurally unreachable — the 9-state vocabulary silently collapses to 7.

## Decision

**GitHub issues become the intake and visibility surface. The corpus keeps authority over resolution.**

Authority is declared per field, not per system:

| Field | Authority | GitHub representation | Read back as truth |
|---|---|---|---|
| title, description, expected, actual, repro | consumer at filing; corpus archives | issue title + body | no |
| severity, category, tags | **reporter**, any permission level | body front-matter | yes — sole copy |
| resolution (9 states) | **corpus** (`computeIssueResolution`) | `resolution:*` label | **never** — drift check only |
| `state` / `state_reason` | GitHub | native | advisory; must be ratified via `lore issue resolve` |
| `adopted` owner pointer | **corpus**, typed `plan\|task` | not representable | n/a |

Reporter metadata lives in the issue **body**, not in labels, because the REST docs state verbatim: *"Only users with push access can set labels for new issues. **Labels are silently dropped otherwise.**"* Labels are therefore unusable for reporter-supplied data by exactly the permissionless third parties this ships to. The same sentence is what makes labels *safe* for `resolution:*` — an outside reporter cannot forge a verdict.

## Quality Attributes Affected

| Attribute | Impact | Scenario |
|---|---|---|
| Reachability | **+** the only cross-machine path that exists | QA-1 |
| Modifiability | **+** swapping tracker = swapping one intake adapter; the governance graph does not move | — |
| Integrity | **+** `adopted`-has-a-live-owner and the unconditional `--state fixed` rejection stay enforceable | QA-3 |
| Performance | **−** a sub-millisecond local write becomes a ~690ms p50 network round trip (measured) | QA-6 |
| Availability | **−** filing now depends on GitHub and on a `gh` install | QA-2, QA-4 |
| Consistency | **−** resolution exists in two places with projection lag | R6 |

## Alternatives Considered

| Option | Pros | Cons | Why rejected |
|---|---|---|---|
| GitHub as full SSOT, corpus stores a pointer | one authority, no lag, GitHub UI just works | 9 states collapse to 7 (`corpus-service.ts:4487`); GitHub's "Close as completed" becomes a permanent back door around the unconditional `--state fixed` rejection, unclosable because you cannot disable a GitHub button; `isDanglingAdoption` goes blind to label-only adoption; tracker migration becomes data loss | Puts the unreplaceable thing (governance graph) on the replaceable substrate (a hosted tracker) |
| Bidirectional sync + reconciler | full 9-state fidelity visible on both sides | a reconciler and a drift detector maintained forever for a channel measured at 12 reports in 11 days; two writable copies have no single truth; reconciler failure is silent | Cost review named it the largest hidden cost in the proposal; violates SSOT |
| Implement `transport: "http"` against a `lore serve` endpoint | stays inside lore's own model, no third party | every consumer needs a reachable, authenticated upstream server, plus token distribution and its own abuse controls — rebuilding what GitHub already operates | Build-vs-buy: this is an issue tracker |
| Leave it local, document the limitation | zero work | the channel's stated purpose is unachievable; the fresh-install test keeps failing | Does not address the defect |

## Disposition of the Superseded Mechanisms

The parent PRD's G14 required **four** R-5 safety rails to be oracle-tested. This decision retires three of them, so each is dispositioned explicitly rather than left to inference. G14 was amended in the same round (PRD v75→v76) so the goal and this record cannot disagree.

| Original rail | Disposition | Why |
|---|---|---|
| identity pin (upstream root PRD match) | **Superseded** by an authenticated target check: assert `gh api user` login, pass the repo explicitly, never infer it from a git remote or `GH_REPO` | A hosted tracker has no root-PRD analogue, and `gh`'s own target inference is attacker-influencable |
| version-skew reject | **Not applicable** | It compared the consumer's schema version against the upstream corpus's `PRAGMA user_version`. GitHub exposes no such version |
| sync-upstream reject | **Not applicable** | It refused when the upstream ran a Turso replica, to prevent a write landing only-local. There is no replica in a GitHub intake path |
| rate cap | **Deleted** | Abuse control belongs to the tracker. Measured 2026-08-23: 10 open reports against a ceiling of 10 refused every new report while 6 criticals sat untriaged — the cap was punishing honest reporters, not spammers |

**The 12 reports already filed through the local path** keep their corpus records — they are full `task` docs carrying `extra.issue_report`, and stripping them to pointers would make `fixed`/`resolving` unreachable. Each gains `extra.issue_report.github = {repo, number}` and a minted `idempotency_key` during migration (spec Migration Plan P3).

**SPEC-072 is superseded, not revised** — a `supersedes` edge from the new spec records it. Its transport design (a local `corpus_path` opened as SQLite) is the thing being replaced; its command surface, receipt-log concept and `UpstreamPort` seam all survive in narrowed form. It is no longer the spec of record for this channel.

## Consequences

**Easier**: any machine with `gh` can file. Triage gets a web UI, notifications, search and permissions for free. The open-report cap becomes unnecessary and is deleted (with it `OPEN_REPORT_CAP`, `resolveOpenReportCap`, `countOpenReports`, `OpenReportCapRefusal`, `QUOTA_FREEING_RESOLUTIONS`, `listOpenAdhocDrafts` — whose only production caller is the cap loop at `issue-report-service.ts:595` — and 1214 lines of cap tests). `UpstreamPort` narrows from six corpus-shaped methods to four.

**Harder**: filing requires network and a `gh` install; CI and gh-less machines cannot file, loudly. Resolution must be projected, so a projection-lag detector is now required infrastructure rather than a nicety. Reporter identity must be redacted before it reaches a public issue — `reporterProject` is currently built as `` `${basename(root)} (${root})` `` (`report-issue-wiring.ts:225`), an absolute `$HOME` path, and the actor os-fallback tier (`actor-resolution-node.ts:114`) emits the OS username.

**Unchanged**: `computeIssueResolution` stays derived-only. `lore issue resolve` stays the sole write path into a corpus verdict.

## Validation Plan

1. **Reachability**: file from a machine holding no clone of the upstream repo; assert exit 0 and the issue readable via `gh api`. Fails today by construction.
2. **Round trip**: set each of the 9 resolutions, project, read back — 9/9 equal.
3. **Non-authority of the label**: hand-edit a `resolution:*` label on GitHub, then assert `lore issues` still reports the corpus-derived state and that `lore issues --verify` reports the divergence. This is the oracle that proves the label is a projection rather than a source.
4. **Redaction**: assert no assembled body contains a `$HOME` substring or the OS username.
5. **Fresh-install probe**: a `lore init` + `lore setup` project can file with configuration only, no code edit.
