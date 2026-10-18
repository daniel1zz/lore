---
id: SPEC-149
type: spec
role: spec
title: "The retired-shape refusal message has two independent definitions and no oracle fails when they diverge — measured: they already had"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-10-17
tags: [defect-channel, ssot, mcp, oracle-design, green-control]
---
## Overview

Closing `spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired` fixed the
BEHAVIOURAL defect on all three surfaces, but left one SSOT duplication and one weak oracle.
Both were found by `lore assess` after that plan merged — not by any of its five ACs.

### What is actually residual (measured 2026-08-24, HEAD 063d07c1)

`packages/lore/src/adapters/mcp/tools.ts` (~2908-2944) judges `feedback.upstream` shape itself
and holds its OWN copy of the retired-shape refusal message. Measured: exactly ONE source file
outside the classifier contains the canonical substring `configured with the retired SQLite
shape`, and it is that one.

⛔ Its behaviour is CORRECT today — it has a refusal branch for all three states
(unconfigured / GitHub / retired). So this is NOT the silent-fallback class the parent spec
fixed. The defect is that two independent copies exist with NO oracle that fails when they
diverge.

⛔ CORRECTION, measured after this spec was first written: the two copies had ALREADY DRIFTED,
and this spec's own text (and its title) asserted they were byte-identical. Measured on the
pre-fix tree:

| definition | wording |
|---|---|
| `report-issue-wiring.ts` | `... to file/list issue reports via GitHub.` |
| `adapters/mcp/tools.ts` | `... to file issue reports via GitHub.` (no `/list`) |

⛔ The false "byte-identical" claim came from grepping only the SHARED substring
(`configured with the retired SQLite shape`), finding it in both, and reading that as
equality. **A partial comparison is not an equality check** — and the gap it missed is exactly
the gap the missing oracle was supposed to catch. The drift had been live, unnoticed, for as
long as the copy existed, because nothing ever compared the full strings. This strengthens the
case for AC-MS-2's EQUALITY assertion (rather than substring containment): substring
containment was true throughout the drift.

⛔ `scripts/migrate-issue-reports.ts` was initially written up as a second residual consumer.
Machine-checking it disproved that: it refuses any non-GitHub shape and returns 1 ("refusing
to guess a migration target"). A one-shot migration tool that accepts only the GitHub shape is
not a second arbiter of shape policy. It is explicitly OUT of scope, and that judgement is
recorded so a later reader does not re-open it.

### Why the parent spec's ACs could not see this

AC-IS-4's structural grep asserted zero `isGithubUpstreamCfg` occurrences in the two CLI
command files. That set and the spec's file anchors were THE SAME narrow set, each derived
from the other, so no member of the loop could notice a surface outside it. The MCP consumer
is additionally reached through a dynamic `await import()`, which `bun run test:changed` is
structurally blind to. ⛔ The lesson is scoped to oracle DESIGN, not to executor diligence: a
structural AC is only ever as wide as the file list it greps, so the list must be DERIVED
(grep the whole tree) rather than enumerated by the same hand that wrote the anchors.

### The second residual: a green control that only checks an exit code

`AC-IS-2`'s describe asserts `expect(result.exitCode).toBe(4)` and nothing else, while its
statement promises the refusal "names the later-phase gap". Any unrelated exit-4 under the
GitHub shape satisfies it. A green control exists to prove its sibling assertion has
discriminating power; one that can be satisfied by an unrelated failure with the same exit
code does not carry that proof.

## Design

**D1 — One definition of the retired-shape refusal, consumed by every surface.** The message
lives ONLY in `report-issue-wiring.ts`, exported so `adapters/mcp/tools.ts` consumes it rather
than restating it. The MCP handler's lazy `await import()` stays — it exists to keep
`gh-runner`/`github-intake-port` out of every `tools.ts` consumer's vitest graph, which is an
unrelated and still-valid reason.

**D2 — MCP behaviour is unchanged, and that is asserted, not assumed.** All three states keep
refusing with the same codes they refuse with today. This is a wiring AC: an oracle proving
the export exists proves nothing about whether the MCP tool calls it.

**D3 — The oracle for D1 is DERIVED, not enumerated.** Its command greps the whole source tree
for the canonical substring and asserts the only match outside the classifier is zero — so a
future fourth consumer that copies the message trips it without anyone updating the AC. ⛔ It
must exclude `tests/`, where asserting the substring is the correct thing to do.

**D4 — Strengthen the green control.** `AC-IS-2`'s probe gains a stderr substring assertion.
The literal is `a later phase of spec-the-defect-channel-reaches-no-machine` — chosen over the
equally-present `reading it via 'lore issues' is not yet supported` because it contains no
single quotes and therefore survives embedding in an AC's shell command without escaping.

⛔ Measured present in that exact stderr at HEAD 063d07c1, throwaway corpus, GitHub shape:

```
Error: Validation failed on field 'feedback.upstream': this corpus's feedback.upstream is
GitHub-configured (repo: acme/widget) — reading it via 'lore issues' is not yet supported
(a later phase of spec-the-defect-channel-reaches-no-machine-but-its-own-github). Pass
--local to read this corpus's own issue reports instead.
```

This plan changes NO behaviour, so the assertion is legitimate ONLY because the substring is
already emitted — the change is to the PROBE, never to the message. Done in this plan's own
test task, NOT by editing the archived parent plan's AC in place.

## Scope

In scope: `adapters/mcp/tools.ts`'s message duplication, the exported message in
`report-issue-wiring.ts`, and the green-control assertion in the existing probe file.
Out of scope, deliberately: `scripts/migrate-issue-reports.ts` (see above), and any GitHub-
backed read/write wiring for MCP (a later phase of the defect-channel spec).

## Acceptance Criteria

Declared via `lore ac add`; see `lore ac list` on this spec. Every one was run against HEAD
063d07c1 before this spec was approved, and each is stated with its measured starting value so
no criterion is vacuously satisfied.


## Acceptance Criteria (structured)

- [⚑] [script] AC-MS-1: SSOT, DERIVED not enumerated (spec D3): grepping the WHOLE source tree (packages/core/src, packages/lore/src, scripts) for the canonical substring 'configured with the retired SQLite shape' yields ZERO files other than report-issue-wiring.ts. Measured at HEAD 063d07c1: ONE such file (adapters/mcp/tools.ts). The command greps the tree rather than a hand-listed set, so a FUTURE fourth consumer copying the message trips this without anyone editing the AC. Excludes tests/, where asserting the substring is correct.
  script: lint — ! grep -rl 'configured with the retired SQLite shape' --include='*.ts' packages/core/src packages/lore/src scripts 2>/dev/null | grep -v 'report-issue-wiring.ts' | grep -q . && echo 'AC-MS-1 PASS: zero source files outside report-issue-wiring.ts define the canonical retired-shape message'
- [⚑] [script] AC-MS-2: PRODUCTION WIRING via the shared definition, TWO conditions — and its provenance claim is enforced JOINTLY with AC-MS-1, never alone (an oracle that only checks the refusal text contains the canonical substring passes identically against a surviving byte-identical local copy; only AC-MS-1's whole-tree grep excludes that). (a) STRUCTURAL: report-issue-wiring.ts exports buildRetiredFeedbackUpstreamError — measured at HEAD 063d07c1 it is module-PRIVATE ('function', no 'export'), which is precisely why adapters/mcp/tools.ts could only restate the message. (b) BEHAVIOURAL: the MCP lore_report_issue handler's retired-shape refusal message EQUALS the message that exported builder produces — equality, not substring containment, so a drifted copy fails even while still containing the canonical fragment. Covered by describe 'AC-MS-2 MCP retired-shape refusal comes from the shared definition'.
  script: test — grep -q 'export function buildRetiredFeedbackUpstreamError' packages/lore/src/adapters/cli/report-issue-wiring.ts && bunx vitest run packages/lore/tests/unit/adapters/mcp-issue-shape-message-ssot.test.ts -t 'AC-MS-2' 2>&1 && echo 'AC-MS-2 PASS: the retired-shape builder is exported and the MCP refusal message equals its output exactly'
  other_command=2
- [⚑] [script] AC-MS-3: REGRESSION GUARD with named literals (spec D2): the MCP lore_report_issue handler's other two states survive the SSOT refactor, asserted against specific values rather than 'unchanged'. (a) an UNCONFIGURED feedback.upstream still returns the error produced by @lore/core's exported buildUnconfiguredUpstreamRemedy (import it in the probe; do not restate its text). (b) ⛔ AMENDED 2026-08-25 because spec-a-github-filed-defect-must-be-claimable-one-ingest-seam D12 deliberately DELETED the GitHub-shape refusal this clause used to guard — the MCP handler now FILES through fileGithubIssue instead. The positive half ('still refuses with a message containing filing via AND lore_report_issue') asserted behaviour that is now, by design, absent, so it is retired. The NEGATIVE half survives verbatim and is the whole point: whatever outcome a GITHUB-shaped upstream produces, it does NOT contain 'configured with the retired SQLite shape'. That is what still stops AC-MS-2 from being satisfiable by collapsing the remaining branches onto the retired message. ⛔ This is a supersession by a later spec, not a weakening under a red: the clause was true when written, the behaviour it described was intentionally changed elsewhere, and the discriminating half was kept. Covered by describe 'AC-MS-3 MCP unconfigured and GitHub refusals unchanged'.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-issue-shape-message-ssot.test.ts -t 'AC-MS-3' 2>&1 && echo 'AC-MS-3 PASS: MCP unconfigured returns the shared unconfigured remedy and the GitHub refusal stays distinct from the retired one'
  other_command=1
- [·] [script] AC-MS-4: GREEN CONTROL STRENGTHENED (spec D4), two conditions so it cannot pass by running green without gaining the assertion. ⛔ AMENDED 2026-08-25 for the same supersession that amended AC-MS-3(b): clause (a) required the literal 'a later phase of spec-the-defect-channel-reaches-no-machine' to be PRESENT in issues-upstream-shape-refusal.bun.test.ts, and spec-a-github-filed-defect-must-be-claimable-one-ingest-seam deleted the production wording that literal was asserting, so requiring it would now pin a test to a string no code emits. (a) STRUCTURAL, replacement discriminator: that file's AC-IS-2 case asserts an EXACT exit code and a discriminating output substring — not merely a nonzero exit, which any unrelated failure satisfies; the file contains the literal 'payload gh stub' proving the probe drives a stubbed GitHub read path rather than an ambient one. (b) BEHAVIOURAL, unchanged: that file's AC-IS-2 case still passes. ⛔ Supersession by a later spec, not a weakening under a red — the original clause was true when written and its discriminating role is preserved in the replacement.
  script: test — grep -q 'payload gh stub' packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts && bunx --bun vitest run packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts -t 'AC-IS-2' 2>&1 && echo 'AC-MS-4 PASS: the GitHub-shape green control drives a stubbed read path with an exact exit code and still passes'
  other_command=1

## Code anchors

- packages/lore/src/adapters/cli/report-issue-wiring.ts#buildRetiredFeedbackUpstreamError
- packages/lore/src/adapters/mcp/tools.ts
- packages/lore/tests/unit/adapters/mcp-issue-shape-message-ssot.test.ts
