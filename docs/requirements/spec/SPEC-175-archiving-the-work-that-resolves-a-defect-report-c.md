---
id: SPEC-175
type: spec
role: spec
title: "Archiving the work that resolves a defect report closes its GitHub issue"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-17
tags: []
---
# Archiving the work that resolves a defect report closes its GitHub issue

**Goal**: when a specification, plan or task that is bound to a filed defect report (a `resolves` link) is archived, the report's GitHub issue is closed automatically, with a comment naming the work; binding is made at creation time; a sync repairs anything an archive could not close. User request 2026-10-12: "issue应该有自动关闭机制……plan或者什么绑定了issue，关闭的时候就应该检查有没有绑定issue，绑定了就应该关闭issue".

**Why (measured 2026-10-12)**: #162, #168 and #169 were fixed and their plans/tasks archived, yet all three stayed `open` in `lore issues` and on GitHub. The only binding is a hand-made `resolves` link (`spec-issue-closure-loop-computed-resolution-agent-reachable` D1b); the plan said "closes #162" in prose only. Nothing in `packages/lore/src` closes a GitHub issue; the only GitHub write is the `resolution:*` label in `lore issue resolve` (`commands/issue.ts:896`), which refuses `fixed` by design (D3 of that spec). Plan close and `lore done` never read issues. Adding a label that does not exist yet failed with HTTP 403 for this repository's token, while closing succeeded.

**Baseline**: this spec's change set (`lore rule changes spec-archiving-the-work-that-resolves-a-defect-report-closes`) proposes BR-1082 (close on archive + sync, lands on `baseline-resolve-a-defect-report`) and BR-1083 (bind at creation, lands on `baseline-create-a-document`); they enter the baseline only when this spec's criteria pass (`spec-a-spec-carries-its-rule-changes-the-baseline-takes-them`). On landing, also update the prose of those leaves and of `baseline-issue-loop` (label also written, and issue closed, on archive) and answer Q2 / BR-537 of `baseline-resolve-a-defect-report` for the fixed case.

## Scope

- An `IssueCloser` port (GitHub via `gh`: close as completed with a comment; add the `resolution:<state>` label best-effort) wired in `app.ts` when `feedback.upstream` is configured.
- One post-archive step in the service layer, reached by EVERY path that moves a spec, plan or task to `archived` (CorpusService status change incl. plan close, `TaskWorkflowService.done`, `lore archive --apply` / cascade paths).
- `lore create spec|plan|task --resolves <number|issue slug>` (repeatable).
- `lore issues --sync [--apply] [--json]`.
- `lore status --check-issues` D5(a) adjusted (see D6).

## Out of scope

- The issue task's own corpus status (stays as is: no auto-approved tasks — that spec's decision stands; the resolution remains computed).
- Reopening GitHub issues; `rejected` / `wontfix` / `superseded` / `duplicate` stay set by `lore issue resolve`.
- Changing when the computed resolution reads `fixed` (an `active` source still computes `fixed`); only archive triggers the GitHub close, because archived means the work landed.

## Design Decisions

- **D1 — trigger.** After a successful transition of a document to `archived`, for each `resolves` out-edge whose target report's computed resolution is `fixed` with at least one ARCHIVED resolving source (the one just archived counts) and which carries `extra.issue_report.github`, call the closer. Post-commit: the archive is never rolled back.
- **D2 — closer contract.** Close with `state_reason: completed` and a comment `Fixed by <type> <slug> (archived <date>)`; then set the `resolution:fixed` label. A closed-already issue is a no-op success. Each of the three calls (close, comment, label) returns its own typed outcome; a comment or label failure never undoes the close. A later `--sync` does not re-post a missing comment (the issue is closed, so it is not drift) but does re-apply a missing label.
- **D3 — failure is loud and repairable.** Every failure prints one line naming the issue number and the error, and writes one audit row (`issue_close_failed`, with the issue number and error). `lore issues --sync` lists drift of two kinds: (a) a report whose computed resolution is `fixed` and that has at least one ARCHIVED resolving source, while its GitHub issue is open or lacks `resolution:fixed` — `--apply` closes and labels it (a `fixed` that rests only on an `active` source is not drift: the work has not landed, matching D1); (b) a report in any other terminal state (rejected, wontfix, superseded, duplicate, closed) whose `resolution:<state>` label is missing — `--apply` only labels it and never closes it (closing those is a separate product decision, baseline-resolve-a-defect-report BR-537 / Q2). Without `--apply` it writes nothing. Exit codes: 0 when there is no drift or every apply succeeded; 1 when any apply failed (each failure named in `applied[].error`); 2 on usage.
- **D4 — service layer, all surfaces.** The step lives where the transition is committed so CLI, MCP and HTTP archive the same way; the closer is an injected optional port (absent → the step reports "GitHub not configured — run lore issues --sync after configuring feedback.upstream", never silent).
- **D5 — binding at creation.** `--resolves <n>` resolves `n` to the deterministic slug `task-gh-<repo_id>-<n>` (the `lore issue adopt` rule) or accepts an issue slug; every named report must exist and carry `extra.issue_report`, else the whole creation is refused (exit 4, nothing written). The links are written in the same command.
- **D6 — prose warning, and the check that would now be noise.** On archive, a document whose content matches `\b(closes|fixes|resolves)\s+#(\d+)` for a filed report with no `resolves` link from it prints one warning per number with the `lore link` command. `lore status --check-issues` D5(a) ("resolving source terminal while the issue is not archived") no longer flags reports whose computed resolution is `fixed` — the computed resolution plus the closed GitHub issue are the record; it still flags everything else it flags today.

## Public Interface

```
lore create <spec|plan|task> ... [--resolves <n|task-gh-…>]...
lore issues --sync [--apply] [--json]
  --json → { ok, data: { drift: [{ number, slug, computed, github_state, missing_label: boolean }],
                         applied?: [{ number, closed: boolean, labelled: boolean, error?: string }] } }
On archive (stdout): "issue #<n>: closed on GitHub (fixed by <slug>)" | stderr: "issue #<n>: close FAILED: <err> — run lore issues --sync"
```

## Edge cases

| Situation | Result |
|---|---|
| plan with resolves → #N archived, gh ok | #N closed as completed, comment, label set |
| label missing and token lacks admin (403) | #N closed; label failure printed + audit row |
| gh unreachable | archive succeeds; failure printed + audit row; `--sync --apply` later closes |
| issue already closed on GitHub | no-op success |
| `feedback.upstream` not configured | archive succeeds; one line says GitHub not configured |
| report has no `github` ref (local-only report) | nothing to close; one line says so |
| two archived docs both resolve #N | first closes; second is a no-op |
| `--resolves 999` with no such report | creation refused, exit 4, nothing written |
| body says "closes #162", no link | warning with `lore link <doc> task-gh-…-162 --type resolves` |

## Acceptance Criteria

Declared with `lore ac add` (AC-IC-1..5).


## Acceptance Criteria (structured)

- [⚑] [script] AC-IC-1: Service-level post-archive step on InMemoryStore with a recording fake IssueCloser (new file issue-close-on-archive.test.ts): (a) archiving a plan that resolves a filed report with a github ref calls close(#N) once with a comment naming the plan, then label(resolution:fixed); (b) the same through TaskWorkflowService.done for a task and through the archive-apply/cascade path; (c) closer close failure -> the archive is still committed, one audit row issue_close_failed with the number and error, the result names the failure; (d) label failure after a successful close -> close kept, failure reported; (e) closer absent -> archive committed, result says GitHub not configured; (f) report without a github ref -> no close call, result says so; (g) issue already closed -> no-op success; (h) a document whose content says 'closes #N' for a filed report with no resolves link -> a warning naming N and the lore link command; (i) a report whose only resolving source is active (not archived) is not closed when an unrelated doc is archived; (j) a close success with a comment failure keeps the close and reports the comment failure; (k) the issue task's own status is unchanged in every case. Smallest red mutation: calling the step only from CorpusService.set misses (b).
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-close-on-archive.test.ts
- [⚑] [script] AC-IC-2: Compiled CLI with a stub gh on PATH and a throwaway corpus configured with feedback.upstream (new file issue-close-on-archive-compiled.bun.test.ts): a filed report for #7 with a github ref; lore create plan ... --resolves 7 writes the plan and a resolves link (lore get shows it); --resolves 999 exits exactly 4 and creates nothing; --resolves naming an existing document that is not a filed report exits exactly 4 and creates nothing; --resolves given twice (number and task-gh slug forms) writes both links; archiving that plan (lore set <plan> --status archived after its tasks are done) exits 0, prints 'issue #7: closed on GitHub', and the stub gh log shows a close with state_reason completed and a comment naming the plan slug; with the stub gh failing, the archive still exits 0, stderr names '#7' and 'lore issues --sync', and lore issues --sync --json then lists #7 in drift while --sync --apply closes it (stub log). Smallest red mutation: not wiring the closer in app.ts makes the close log empty.
  script: e2e — bun run build && bunx --bun vitest run packages/lore/tests/e2e/issue-close-on-archive-compiled.bun.test.ts
- [⚑] [script] AC-IC-3: The real IssueCloser over an injected gh runner (new file issue-closer-port.test.ts): close issues 'gh api -X PATCH repos/<repo>/issues/<n> -f state=closed -f state_reason=completed' (or the gh issue close equivalent) and posts the comment; an already-closed issue is a no-op; a 403 on the label call returns a typed label failure without undoing the close; a non-zero gh exit on close returns a typed close failure carrying stderr; nothing is retried silently. Smallest red mutation: swallowing the label error makes the 403 case report success.
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-closer-port.test.ts
- [⚑] [script] AC-IC-4: lore issues --sync (new file issues-sync.test.ts, recording fake closer): drift (a) a fixed report with an archived resolving source and an open GitHub issue or missing resolution:fixed label -> listed; a fixed report resting only on an active source -> NOT listed; (b) a rejected/wontfix/superseded/duplicate/closed report missing its resolution:<state> label -> listed. Without --apply: closer never called, exit 0. With --apply: (a) closed and labelled, (b) labelled and never closed; --json applied[] carries {number, closed, labelled, error?}; exit 0 when all succeed, exactly 1 when any fails. lore status --check-issues no longer flags a report whose computed resolution is fixed and still flags its other cases (status-check-issues.test.ts: new or extended — retired assertions deleted, none skipped). Smallest red mutation: closing a (b) report fails the never-closed assertion.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/issues-sync.test.ts packages/lore/tests/unit/adapters/status-check-issues.test.ts
- [⚑] [script] AC-IC-5: bun run typecheck exits 0 with the closer port wired through app.ts and every archive path.
  script: tsc — bun run typecheck

## Code anchors

- packages/lore/src/service/issue-closer-port.ts
- packages/lore/src/service/issue-close-on-archive.ts
